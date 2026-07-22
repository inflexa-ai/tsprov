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
      // 1. Build both packages so their `dist/` is present in the tarballs.
      for (const dir of [CORE_DIR, RENDER_CORE_DIR]) {
        const built = await $`bun run build`.cwd(dir).quiet().nothrow();
        expect(`build ${dir} exit ${built.exitCode}`).toBe(
          `build ${dir} exit 0`,
        );
      }

      // 2. Pack both into tarballs (no registry).
      for (const dir of [CORE_DIR, RENDER_CORE_DIR]) {
        const packed =
          await $`bun pm pack --destination ${packDir}`.cwd(dir).quiet().nothrow();
        expect(`pack ${dir} exit ${packed.exitCode}`).toBe(`pack ${dir} exit 0`);
      }
      const tarballs = readdirSync(packDir)
        .filter((f) => f.endsWith(".tgz"))
        .map((f) => join(packDir, f));
      const coreTgz = tarballs.find((f) => f.includes("tsprov-0."));
      const renderTgz = tarballs.find((f) => f.includes("render-core"));
      if (coreTgz === undefined || renderTgz === undefined) {
        throw new Error(`missing tarballs: ${tarballs.join(", ")}`);
      }

      // 3. A fresh consumer project installs BOTH tarballs. The core tarball
      //    satisfies render-core's tsprov peer without any registry lookup.
      await Bun.write(
        join(consumer, "package.json"),
        `${JSON.stringify(
          { name: "consumer", version: "0.0.0", private: true, type: "module" },
          null,
          2,
        )}\n`,
      );
      const added =
        await $`bun add ${coreTgz} ${renderTgz}`.cwd(consumer).quiet().nothrow();
      expect(`bun add exit ${added.exitCode}`).toBe("bun add exit 0");

      // 4. Exactly one @inflexa-ai/tsprov in the consumer tree (render-core did not
      //    drag in a second copy — the peer resolved to the installed one).
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
          `const doc = new ProvDocument();`,
          `const scene: RenderScene = toRenderScene(doc, { useLabels: true });`,
          `const direction: string = PROV_THEME.direction;`,
          `export type StringRenderer = Renderer<string>;`,
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
