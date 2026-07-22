import { test, expect } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The gated single-instance packaging eval. Expensive (it builds, packs, and installs
// real tarballs), so it self-skips unless `TSPROV_EVAL_FULL=1` — bare `bun test` (CI)
// stays fast; `bun run eval` opens the gate. It proves the peer-dependency story end
// to end: a consumer installs tsprov and render-core from tarballs (no registry needed
// for the peer — the core tarball satisfies it), gets exactly ONE tsprov in its tree,
// gets working cross-package `instanceof` identity, and typechecks under both
// `moduleResolution: bundler` and `nodenext`.

const FULL = process.env.TSPROV_EVAL_FULL === "1";
if (!FULL) {
  console.log(
    "[packaging eval] skipped — set TSPROV_EVAL_FULL=1 (or run `bun run eval`) to execute it.",
  );
}

const REPO_ROOT = `${import.meta.dir}/../..`;
const CORE_DIR = join(REPO_ROOT, "packages/tsprov");
const RENDER_CORE_DIR = join(REPO_ROOT, "packages/tsprov-render-core");
const RENDER_DOT_DIR = join(REPO_ROOT, "packages/tsprov-render-dot");
const RENDER_MERMAID_DIR = join(REPO_ROOT, "packages/tsprov-render-mermaid");
const RENDER_SVG_DIR = join(REPO_ROOT, "packages/tsprov-render-svg");
const RENDER_INTERACTIVE_DIR = join(REPO_ROOT, "packages/tsprov-render-interactive");

/** Recursively counts directories named exactly `@inflexa-ai/tsprov` (not `-render-core`). */
function countTsprovInstances(root: string): string[] {
  const found: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (full.endsWith(join("@inflexa-ai", "tsprov"))) {
        found.push(full);
        continue; // don't descend into the package itself
      }
      walk(full);
    }
  }
  walk(root);
  return found;
}

test.skipIf(!FULL)(
  "tarball-installed consumer has one tsprov, instanceof identity, and dual typecheck",
  async () => {
    const work = mkdtempSync(join(tmpdir(), "tsprov-packaging-"));
    const packDir = join(work, "tarballs");
    const consumer = join(work, "consumer");
    await $`mkdir -p ${packDir} ${consumer}`.quiet();

    try {
      // 1. Pack each publishable package into a tarball (no registry). We deliberately do NOT
      //    pre-build: `bun pm pack` fires each render package's `prepack` hook (verified in bun
      //    1.3.14), so the pack step itself produces `dist/`. That is what makes the
      //    tarball-content assertions below a real regression pin for those hooks — a vanished or
      //    broken `prepack` means missing dist files, which turns the "tarball has package/dist/…"
      //    assertions red. (`@inflexa-ai/tsprov` builds via `prepublishOnly`, which pack does NOT
      //    fire; its already-built `dist/` is consumed as-is and is out of scope for this pin.)
      for (const dir of [CORE_DIR, RENDER_CORE_DIR, RENDER_DOT_DIR, RENDER_MERMAID_DIR, RENDER_SVG_DIR, RENDER_INTERACTIVE_DIR]) {
        const packed =
          await $`bun pm pack --destination ${packDir}`.cwd(dir).quiet().nothrow();
        expect(`pack ${dir} exit ${packed.exitCode}`).toBe(`pack ${dir} exit 0`);
      }
      const tarballs = readdirSync(packDir)
        .filter((f) => f.endsWith(".tgz"))
        .map((f) => join(packDir, f));
      const coreTgz = tarballs.find((f) => f.includes("tsprov-0."));
      const renderTgz = tarballs.find((f) => f.includes("render-core"));
      const renderDotTgz = tarballs.find((f) => f.includes("render-dot"));
      const renderMermaidTgz = tarballs.find((f) => f.includes("render-mermaid"));
      const renderSvgTgz = tarballs.find((f) => f.includes("render-svg"));
      const renderInteractiveTgz = tarballs.find((f) => f.includes("render-interactive"));
      if (
        coreTgz === undefined ||
        renderTgz === undefined ||
        renderDotTgz === undefined ||
        renderMermaidTgz === undefined ||
        renderSvgTgz === undefined ||
        renderInteractiveTgz === undefined
      ) {
        throw new Error(`missing tarballs: ${tarballs.join(", ")}`);
      }

      // 2. What actually SHIPS in each render tarball. A tarball whose `exports` point at a
      //     `dist/` that never made it in resolves to ENOENT on install; the `prepack` build
      //     hook is what keeps that from happening, and this asserts the payload it produces.
      //     npm prefixes every entry with `package/`. Each render package must ship its two
      //     community files (LICENSE + NOTICE — Apache-2.0 §4(d)), its README, and BOTH build
      //     entries (the dual ESM + CJS contract).
      const renderTarballs: { name: string; tgz: string }[] = [
        { name: "render-core", tgz: renderTgz },
        { name: "render-dot", tgz: renderDotTgz },
        { name: "render-mermaid", tgz: renderMermaidTgz },
        { name: "render-svg", tgz: renderSvgTgz },
        { name: "render-interactive", tgz: renderInteractiveTgz },
      ];
      for (const { name, tgz } of renderTarballs) {
        const listed = await $`tar -tzf ${tgz}`.quiet().nothrow();
        expect(`tar ${name} exit ${listed.exitCode}`).toBe(`tar ${name} exit 0`);
        const entries = listed.stdout.toString().split("\n");
        for (const required of [
          "package/README.md",
          "package/LICENSE",
          "package/NOTICE",
          "package/dist/index.js",
          "package/dist/cjs/index.js",
        ]) {
          expect(`${name} tarball has ${required}: ${entries.includes(required)}`).toBe(
            `${name} tarball has ${required}: true`,
          );
        }
        // interactive ships the COMPILED client (src/template.generated.ts) only — the raw
        // template/ authoring sources are `bun run gen` inputs and must never leak into the
        // published artifact.
        if (name === "render-interactive") {
          const templateLeak = entries.filter((e) => e.startsWith("package/template/"));
          expect(`interactive template/ entries: ${templateLeak.length}`).toBe(
            "interactive template/ entries: 0",
          );
        }
      }

      // 3. A fresh consumer project installs ALL SIX tarballs. The core tarball satisfies
      //    every sibling's tsprov peer; the render-core tarball satisfies render-dot's,
      //    render-mermaid's, render-svg's, AND render-interactive's `^0.1.0` sibling
      //    dependency; and the render-svg tarball satisfies render-interactive's `^0.1.0`
      //    render-svg dependency — both pinned offline via `overrides`. render-svg's OTHER
      //    runtime dependency, `@dagrejs/dagre@^3`, is NOT overridden: it is a published
      //    package, so it resolves from the real npm registry exactly as a downstream
      //    consumer's install would — the heavy dep is real and paid for on install, and it
      //    reaches interactive transitively through the render-svg it depends on.
      await Bun.write(
        join(consumer, "package.json"),
        `${JSON.stringify(
          {
            name: "consumer",
            version: "0.0.0",
            private: true,
            type: "module",
            overrides: {
              "@inflexa-ai/tsprov-render-core": renderTgz,
              "@inflexa-ai/tsprov-render-svg": renderSvgTgz,
            },
          },
          null,
          2,
        )}\n`,
      );
      const added =
        await $`bun add ${coreTgz} ${renderTgz} ${renderDotTgz} ${renderMermaidTgz} ${renderSvgTgz} ${renderInteractiveTgz}`
          .cwd(consumer)
          .quiet()
          .nothrow();
      expect(`bun add exit ${added.exitCode}`).toBe("bun add exit 0");

      // 3b. render-svg's dagre dependency resolved from the registry into the tree.
      const dagreInstalled = existsSync(
        join(consumer, "node_modules", "@dagrejs", "dagre", "package.json"),
      );
      expect(`@dagrejs/dagre resolved from registry: ${dagreInstalled}`).toBe(
        "@dagrejs/dagre resolved from registry: true",
      );

      // 4. Exactly one @inflexa-ai/tsprov in the consumer tree (neither sibling dragged
      //    in a second copy — the peer resolved to the installed one).
      const instances = countTsprovInstances(join(consumer, "node_modules"));
      expect(`tsprov instances: ${instances.length}`).toBe("tsprov instances: 1");

      // 5. Cross-package instanceof identity. render-core's `toRenderScene` sets an
      //    attribute's `valueUri` only when the value passes `instanceof Identifier`
      //    (its own tsprov import). A QName-valued attribute created via the consumer's
      //    tsprov import getting a `valueUri` proves both imports are the SAME class.
      await Bun.write(
        join(consumer, "identity.mjs"),
        [
          `import { ProvDocument, ns } from "@inflexa-ai/tsprov";`,
          `import { toRenderScene } from "@inflexa-ai/tsprov-render-core";`,
          `const ex = ns("ex", "http://example.org/");`,
          `const doc = new ProvDocument();`,
          `doc.addNamespace(ex.prefix, ex.uri);`,
          `doc.entity(ex.qn("e"), [[ex.qn("seeAlso"), ex.qn("other")]]);`,
          `const scene = toRenderScene(doc);`,
          `const attr = scene.nodes[0]?.attributes?.[0];`,
          `if (!attr || attr.valueUri !== "http://example.org/other") {`,
          `  console.error("instanceof identity FAILED:", JSON.stringify(attr));`,
          `  process.exit(1);`,
          `}`,
          `console.log("instanceof identity OK");`,
          ``,
        ].join("\n"),
      );
      const identity =
        await $`bun run identity.mjs`.cwd(consumer).quiet().nothrow();
      expect(`identity exit ${identity.exitCode}`).toBe("identity exit 0");

      // 5b. render-dot works end to end from the installed tarballs: a document built
      //    with the consumer's tsprov renders to a DOT digraph with the themed entity.
      await Bun.write(
        join(consumer, "dot.mjs"),
        [
          `import { ProvDocument, ns } from "@inflexa-ai/tsprov";`,
          `import { DotRenderer } from "@inflexa-ai/tsprov-render-dot";`,
          `const ex = ns("ex", "http://example.org/");`,
          `const doc = new ProvDocument();`,
          `doc.addNamespace(ex.prefix, ex.uri);`,
          `doc.entity(ex.qn("e"));`,
          `const dot = new DotRenderer().render(doc);`,
          `if (!dot.startsWith("digraph G {") || !dot.includes('fillcolor="#FFFC87"')) {`,
          `  console.error("render-dot FAILED:", dot);`,
          `  process.exit(1);`,
          `}`,
          `console.log("render-dot OK");`,
          ``,
        ].join("\n"),
      );
      const dotRun = await $`bun run dot.mjs`.cwd(consumer).quiet().nothrow();
      expect(`dot exit ${dotRun.exitCode}`).toBe("dot exit 0");

      // 5c. render-mermaid works end to end too: the same consumer-built document
      //    renders to a flowchart with the themed entity classDef.
      await Bun.write(
        join(consumer, "mermaid.mjs"),
        [
          `import { ProvDocument, ns } from "@inflexa-ai/tsprov";`,
          `import { MermaidRenderer } from "@inflexa-ai/tsprov-render-mermaid";`,
          `const ex = ns("ex", "http://example.org/");`,
          `const doc = new ProvDocument();`,
          `doc.addNamespace(ex.prefix, ex.uri);`,
          `doc.entity(ex.qn("e"));`,
          `const mmd = new MermaidRenderer().render(doc);`,
          `if (!mmd.startsWith("flowchart BT") || !mmd.includes("classDef entity fill:#FFFC87")) {`,
          `  console.error("render-mermaid FAILED:", mmd);`,
          `  process.exit(1);`,
          `}`,
          `console.log("render-mermaid OK");`,
          ``,
        ].join("\n"),
      );
      const mermaidRun = await $`bun run mermaid.mjs`.cwd(consumer).quiet().nothrow();
      expect(`mermaid exit ${mermaidRun.exitCode}`).toBe("mermaid exit 0");

      // 5d. render-svg works end to end from the installed tarballs — and exercises its
      //    registry-resolved dagre dependency doing real layout: the same consumer-built
      //    document renders to a standalone SVG with the themed entity ellipse.
      await Bun.write(
        join(consumer, "svg.mjs"),
        [
          `import { ProvDocument, ns } from "@inflexa-ai/tsprov";`,
          `import { SvgRenderer } from "@inflexa-ai/tsprov-render-svg";`,
          `const ex = ns("ex", "http://example.org/");`,
          `const doc = new ProvDocument();`,
          `doc.addNamespace(ex.prefix, ex.uri);`,
          `doc.entity(ex.qn("e"));`,
          `const svg = new SvgRenderer().render(doc);`,
          `if (!svg.startsWith("<svg ") || !svg.includes('fill="#FFFC87"') || !svg.includes("viewBox=")) {`,
          `  console.error("render-svg FAILED:", svg);`,
          `  process.exit(1);`,
          `}`,
          `console.log("render-svg OK");`,
          ``,
        ].join("\n"),
      );
      const svgRun = await $`bun run svg.mjs`.cwd(consumer).quiet().nothrow();
      expect(`svg exit ${svgRun.exitCode}`).toBe("svg exit 0");

      // 5e. render-interactive works end to end from the installed tarballs — its two
      //     sibling runtime deps (render-core + render-svg, the layout seam) resolve from the
      //     pinned tarballs, dagre from the registry through render-svg — and it emits ONE
      //     self-contained HTML page: a full document with the payload script and NO external
      //     resource load (the self-containment contract, proven on a real packed install).
      await Bun.write(
        join(consumer, "interactive.mjs"),
        [
          `import { ProvDocument, ns } from "@inflexa-ai/tsprov";`,
          `import { renderInteractiveHtml } from "@inflexa-ai/tsprov-render-interactive";`,
          `const ex = ns("ex", "http://example.org/");`,
          `const doc = new ProvDocument();`,
          `doc.addNamespace(ex.prefix, ex.uri);`,
          `const e = doc.entity(ex.qn("e"));`,
          `const a = doc.activity(ex.qn("a"));`,
          `doc.wasGeneratedBy(e, a);`,
          `const html = renderInteractiveHtml(doc);`,
          `const chrome = html.replace(/<script type="application\\/json"[\\s\\S]*?<\\/script>/, "");`,
          `const externalRefs = /\\ssrc\\s*=|<link\\b|@import\\b|url\\(\\s*['"]?https?:|\\bfetch\\s*\\(|\\bXMLHttpRequest\\b|\\bWebSocket\\b/.test(chrome);`,
          `if (!html.startsWith("<!doctype html>") || !html.includes('id="prov-scene"') || externalRefs) {`,
          `  console.error("render-interactive FAILED (self-contained?", !externalRefs, ")");`,
          `  process.exit(1);`,
          `}`,
          `console.log("render-interactive OK");`,
          ``,
        ].join("\n"),
      );
      const interactiveRun = await $`bun run interactive.mjs`.cwd(consumer).quiet().nothrow();
      expect(`interactive exit ${interactiveRun.exitCode}`).toBe("interactive exit 0");

      // 5f. The CommonJS require() path, run under Node (not Bun — Bun is lenient about ESM,
      //     Node's CJS resolver is the one a real `require()` consumer hits). Node resolves each
      //     package's `require` export condition to its `dist/cjs` build; a single `.cjs` script
      //     requires all five render packages plus tsprov and exercises a DotRenderer render.
      //     The dual build is only real if BOTH entries run — the ESM smokes above cover import;
      //     this is their CJS twin, on the same packed install.
      await Bun.write(
        join(consumer, "cjs-smoke.cjs"),
        [
          `const { ProvDocument, ns } = require("@inflexa-ai/tsprov");`,
          `const { toRenderScene } = require("@inflexa-ai/tsprov-render-core");`,
          `const { DotRenderer } = require("@inflexa-ai/tsprov-render-dot");`,
          `const { MermaidRenderer } = require("@inflexa-ai/tsprov-render-mermaid");`,
          `const { SvgRenderer } = require("@inflexa-ai/tsprov-render-svg");`,
          `const { renderInteractiveHtml } = require("@inflexa-ai/tsprov-render-interactive");`,
          `for (const [n, v] of Object.entries({ toRenderScene, MermaidRenderer, SvgRenderer, renderInteractiveHtml })) {`,
          `  if (typeof v !== "function") {`,
          `    console.error("cjs require FAILED: missing named export from require build:", n);`,
          `    process.exit(1);`,
          `  }`,
          `}`,
          `const ex = ns("ex", "http://example.org/");`,
          `const doc = new ProvDocument();`,
          `doc.addNamespace(ex.prefix, ex.uri);`,
          `doc.entity(ex.qn("e"));`,
          `const dot = new DotRenderer().render(doc);`,
          `if (!dot.startsWith("digraph G {") || !dot.includes('fillcolor="#FFFC87"')) {`,
          `  console.error("cjs require FAILED:", dot);`,
          `  process.exit(1);`,
          `}`,
          `console.log("cjs require OK");`,
          ``,
        ].join("\n"),
      );
      const cjsRun = await $`node cjs-smoke.cjs`.cwd(consumer).quiet().nothrow();
      expect(`cjs require exit ${cjsRun.exitCode}\n${cjsRun.stdout}${cjsRun.stderr}`).toBe(
        "cjs require exit 0\ncjs require OK\n",
      );

      // 5g. Every package's `require` export condition names a CJS `.d.ts` (`dist/cjs/index.d.ts`).
      //     A nodenext CJS consumer resolves types through that path, so the file must actually be
      //     in the installed tree — a resolve-check the type-only smoke below cannot see (it never
      //     takes the `require` branch).
      for (const pkg of [
        "@inflexa-ai/tsprov",
        "@inflexa-ai/tsprov-render-core",
        "@inflexa-ai/tsprov-render-dot",
        "@inflexa-ai/tsprov-render-mermaid",
        "@inflexa-ai/tsprov-render-svg",
        "@inflexa-ai/tsprov-render-interactive",
      ]) {
        const cjsTypes = join(consumer, "node_modules", pkg, "dist", "cjs", "index.d.ts");
        expect(`${pkg} require.types exists: ${existsSync(cjsTypes)}`).toBe(
          `${pkg} require.types exists: true`,
        );
      }

      // 6. Consumer typecheck under BOTH module resolutions. The consumer only uses
      //    the public types of every package; each must resolve cleanly.
      await Bun.write(
        join(consumer, "consumer.ts"),
        [
          `import { ProvDocument } from "@inflexa-ai/tsprov";`,
          `import {`,
          `  toRenderScene,`,
          `  PROV_THEME,`,
          `  type RenderScene,`,
          `  type Renderer,`,
          `} from "@inflexa-ai/tsprov-render-core";`,
          `import { DotRenderer, type DotRenderOptions } from "@inflexa-ai/tsprov-render-dot";`,
          `import { MermaidRenderer, type MermaidRenderOptions } from "@inflexa-ai/tsprov-render-mermaid";`,
          `import { SvgRenderer, type SvgRenderOptions } from "@inflexa-ai/tsprov-render-svg";`,
          `import { InteractiveRenderer, renderInteractiveHtml, type InteractiveRenderOptions } from "@inflexa-ai/tsprov-render-interactive";`,
          `const doc = new ProvDocument();`,
          `const scene: RenderScene = toRenderScene(doc, { useLabels: true });`,
          `const direction: string = PROV_THEME.direction;`,
          `export type StringRenderer = Renderer<string>;`,
          `const opts: DotRenderOptions = { direction: "LR" };`,
          `export const dot: string | Promise<string> = new DotRenderer().render(doc, opts);`,
          `const mopts: MermaidRenderOptions = { direction: "LR" };`,
          `export const mermaid: string | Promise<string> = new MermaidRenderer().render(doc, mopts);`,
          `const sopts: SvgRenderOptions = { direction: "LR" };`,
          `export const svg: string | Promise<string> = new SvgRenderer().render(doc, sopts);`,
          `const iopts: InteractiveRenderOptions = { direction: "LR", focus: "ex:e", title: "Demo" };`,
          `export const html1: string = new InteractiveRenderer().render(doc, iopts) as string;`,
          `export const html2: string = renderInteractiveHtml(doc, iopts);`,
          `export const nodeCount: number = scene.nodes.length;`,
          `export const dir: string = direction;`,
          `export { doc };`,
          ``,
        ].join("\n"),
      );
      const baseCompilerOptions = {
        target: "ESNext",
        lib: ["ESNext"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [] as string[],
      };
      const tsconfigs: Record<string, unknown> = {
        "tsconfig.bundler.json": {
          compilerOptions: {
            ...baseCompilerOptions,
            module: "Preserve",
            moduleResolution: "bundler",
          },
          include: ["consumer.ts"],
        },
        "tsconfig.nodenext.json": {
          compilerOptions: {
            ...baseCompilerOptions,
            module: "nodenext",
            moduleResolution: "nodenext",
          },
          include: ["consumer.ts"],
        },
      };
      for (const [file, config] of Object.entries(tsconfigs)) {
        await Bun.write(
          join(consumer, file),
          `${JSON.stringify(config, null, 2)}\n`,
        );
        const tsc =
          await $`bun x tsc -p ${file}`.cwd(consumer).quiet().nothrow();
        expect(`tsc ${file} exit ${tsc.exitCode}\n${tsc.stdout}${tsc.stderr}`).toBe(
          `tsc ${file} exit 0\n`,
        );
      }
    } finally {
      // Clean up the temp consumer + tarballs regardless of outcome.
      if (existsSync(work)) rmSync(work, { recursive: true, force: true });
    }
  },
  240_000,
);
