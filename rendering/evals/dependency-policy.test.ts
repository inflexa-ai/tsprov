import { test, expect } from "bun:test";
import { readdirSync, existsSync, statSync } from "node:fs";

// The dependency-policy eval mechanically enforces the loop's packaging rules on
// every workspace package's manifest, so a smuggled or misplaced dependency turns a
// test red the moment it lands — and future renderer packages are covered
// automatically (we glob `rendering/*`, we do not enumerate a fixed list).
//
// The rules (from the loop / design):
//  1. `@inflexa-ai/tsprov` is NEVER a runtime `dependency`; a renderer takes it as a
//     `peerDependency` plus a `workspace:*` dev link, nothing else.
//  2. A renderer package may declare `@inflexa-ai/tsprov-render-core` as its ONLY
//     regular dependency — value-semantic family code (plain data + pure functions),
//     so the "zero-weight" rule means zero THIRD-PARTY dependencies. `render-core`
//     itself declares ZERO runtime dependencies.
//  3. The only heavy runtime deps ever allowed are `@dagrejs/dagre` (svg/interactive,
//     as a normal dep) and `@hpcc-js/wasm-graphviz` (graphviz, as a peer) — each only
//     in the package whose name names that renderer.
//  4. The core package itself depends on `luxon` only.

const TSPROV = "@inflexa-ai/tsprov";
const RENDER_CORE = "@inflexa-ai/tsprov-render-core";
const RENDERING_DIR = `${import.meta.dir}/..`;
const CORE_PKG_PATH = `${import.meta.dir}/../../packages/tsprov/package.json`;

/** The subset of a package manifest this eval inspects. */
type Manifest = {
  readonly name?: string;
  readonly private?: boolean;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
};

/** A manifest paired with a human-readable location for failure messages. */
type Package = { readonly label: string; readonly manifest: Manifest };

// The only heavy runtime deps the loop sanctions, each pinned to the renderer whose
// package name contains one of these tokens, in the stated dependency field.
const APPROVED_HEAVY_DEPS: Record<
  string,
  { readonly field: "dependencies" | "peerDependencies"; readonly nameTokens: readonly string[] }
> = {
  "@dagrejs/dagre": { field: "dependencies", nameTokens: ["svg", "interactive"] },
  "@hpcc-js/wasm-graphviz": { field: "peerDependencies", nameTokens: ["graphviz"] },
};

async function readManifest(path: string): Promise<Manifest> {
  // Our own committed manifests; parsed as data.
  return (await Bun.file(path).json()) as Manifest;
}

async function loadRenderingPackages(): Promise<Package[]> {
  const packages: Package[] = [];
  for (const entry of readdirSync(RENDERING_DIR).sort()) {
    const dir = `${RENDERING_DIR}/${entry}`;
    const pkgPath = `${dir}/package.json`;
    if (!statSync(dir).isDirectory() || !existsSync(pkgPath)) continue;
    packages.push({
      label: `rendering/${entry}`,
      manifest: await readManifest(pkgPath),
    });
  }
  return packages;
}

test("the core package depends on luxon only", async () => {
  const core = await readManifest(CORE_PKG_PATH);
  expect(core.name).toBe(TSPROV);
  expect(Object.keys(core.dependencies ?? {}).sort()).toEqual(["luxon"]);
});

test("no rendering package lists tsprov as a runtime dependency", async () => {
  for (const { label, manifest } of await loadRenderingPackages()) {
    const deps = manifest.dependencies ?? {};
    expect(`${label}: ${TSPROV} in dependencies? ${TSPROV in deps}`).toBe(
      `${label}: ${TSPROV} in dependencies? false`,
    );
  }
});

test("a rendering package that peers on tsprov also dev-links it as workspace:*", async () => {
  for (const { label, manifest } of await loadRenderingPackages()) {
    if (manifest.private === true) continue; // the eval harness is not a renderer
    const peers = manifest.peerDependencies ?? {};
    if (!(TSPROV in peers)) continue;
    const dev = manifest.devDependencies ?? {};
    expect(`${label} dev-links tsprov: ${dev[TSPROV]}`).toBe(
      `${label} dev-links tsprov: workspace:*`,
    );
  }
});

test("every rendering runtime dependency is loop-approved and in its sanctioned package", async () => {
  for (const { label, manifest } of await loadRenderingPackages()) {
    const name = manifest.name ?? label;
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      // The render-core sibling is a permitted regular dependency of any OTHER renderer
      // package (it is value-semantic family code, not a third-party weight); render-core
      // must not depend on itself.
      const siblingAllowed = dep === RENDER_CORE && name !== RENDER_CORE;
      const approved = APPROVED_HEAVY_DEPS[dep];
      const heavyAllowed =
        approved !== undefined &&
        approved.field === "dependencies" &&
        approved.nameTokens.some((token) => name.includes(token));
      const allowed = siblingAllowed || heavyAllowed;
      expect(`${label} runtime dep "${dep}" allowed? ${allowed}`).toBe(
        `${label} runtime dep "${dep}" allowed? true`,
      );
    }
  }
});

test("a renderer may declare the render-core sibling as its only regular dependency", async () => {
  const packages = await loadRenderingPackages();
  const renderDot = packages.find((p) => p.manifest.name === "@inflexa-ai/tsprov-render-dot");
  if (renderDot === undefined) throw new Error("render-dot package not found");
  // The sibling dependency is present and is the ONLY regular dependency.
  expect(Object.keys(renderDot.manifest.dependencies ?? {})).toEqual([RENDER_CORE]);
});

test("every rendering peer dependency is tsprov or a loop-approved heavy peer", async () => {
  for (const { label, manifest } of await loadRenderingPackages()) {
    if (manifest.private === true) continue;
    const name = manifest.name ?? label;
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      if (peer === TSPROV) continue;
      const approved = APPROVED_HEAVY_DEPS[peer];
      const allowed =
        approved !== undefined &&
        approved.field === "peerDependencies" &&
        approved.nameTokens.some((token) => name.includes(token));
      expect(`${label} peer dep "${peer}" allowed? ${allowed}`).toBe(
        `${label} peer dep "${peer}" allowed? true`,
      );
    }
  }
});

test("render-core declares zero runtime dependencies", async () => {
  const packages = await loadRenderingPackages();
  const renderCore = packages.find(
    (p) => p.manifest.name === "@inflexa-ai/tsprov-render-core",
  );
  if (renderCore === undefined) throw new Error("render-core package not found");
  expect(Object.keys(renderCore.manifest.dependencies ?? {})).toEqual([]);
});

test("each approved heavy dep appears in at most its sanctioned packages", async () => {
  const packages = await loadRenderingPackages();
  for (const [dep, rule] of Object.entries(APPROVED_HEAVY_DEPS)) {
    for (const { label, manifest } of packages) {
      const name = manifest.name ?? label;
      const present =
        dep in (manifest.dependencies ?? {}) ||
        dep in (manifest.peerDependencies ?? {});
      if (!present) continue;
      const sanctioned = rule.nameTokens.some((token) => name.includes(token));
      expect(`${dep} in ${label} sanctioned? ${sanctioned}`).toBe(
        `${dep} in ${label} sanctioned? true`,
      );
    }
  }
});
