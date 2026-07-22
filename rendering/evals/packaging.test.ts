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
const RENDER_CORE_DIR = join(REPO_ROOT, "rendering/tsprov-render-core");
const RENDER_DOT_DIR = join(REPO_ROOT, "rendering/tsprov-render-dot");
const RENDER_MERMAID_DIR = join(REPO_ROOT, "rendering/tsprov-render-mermaid");

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
      // 1. Build every publishable package so its `dist/` is present in the tarballs.
      for (const dir of [CORE_DIR, RENDER_CORE_DIR, RENDER_DOT_DIR, RENDER_MERMAID_DIR]) {
        const built = await $`bun run build`.cwd(dir).quiet().nothrow();
        expect(`build ${dir} exit ${built.exitCode}`).toBe(
          `build ${dir} exit 0`,
        );
      }

      // 2. Pack each into a tarball (no registry).
      for (const dir of [CORE_DIR, RENDER_CORE_DIR, RENDER_DOT_DIR, RENDER_MERMAID_DIR]) {
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
      if (
        coreTgz === undefined ||
        renderTgz === undefined ||
        renderDotTgz === undefined ||
        renderMermaidTgz === undefined
      ) {
        throw new Error(`missing tarballs: ${tarballs.join(", ")}`);
      }

      // 3. A fresh consumer project installs ALL FOUR tarballs. The core tarball
      //    satisfies every sibling's tsprov peer, and the render-core tarball satisfies
      //    both render-dot's and render-mermaid's `^0.1.0` sibling dependency — all
      //    without any registry lookup.
      await Bun.write(
        join(consumer, "package.json"),
        `${JSON.stringify(
          {
            name: "consumer",
            version: "0.0.0",
            private: true,
            type: "module",
            // render-dot and render-mermaid each declare `@inflexa-ai/tsprov-render-core:
            // ^0.1.0`; with no registry, an `overrides` entry pins that resolution to the
            // render-core tarball so both siblings' dependency resolves offline (exactly
            // the local-file substitution a monorepo consumer would use pre-publish).
            overrides: { "@inflexa-ai/tsprov-render-core": renderTgz },
          },
          null,
          2,
        )}\n`,
      );
      const added =
        await $`bun add ${coreTgz} ${renderTgz} ${renderDotTgz} ${renderMermaidTgz}`
          .cwd(consumer)
          .quiet()
          .nothrow();
      expect(`bun add exit ${added.exitCode}`).toBe("bun add exit 0");

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

      // 6. Consumer typecheck under BOTH module resolutions. The consumer only uses
      //    the public types of both packages; each must resolve cleanly.
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
          `const doc = new ProvDocument();`,
          `const scene: RenderScene = toRenderScene(doc, { useLabels: true });`,
          `const direction: string = PROV_THEME.direction;`,
          `export type StringRenderer = Renderer<string>;`,
          `const opts: DotRenderOptions = { direction: "LR" };`,
          `export const dot: string | Promise<string> = new DotRenderer().render(doc, opts);`,
          `const mopts: MermaidRenderOptions = { direction: "LR" };`,
          `export const mermaid: string | Promise<string> = new MermaidRenderer().render(doc, mopts);`,
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
