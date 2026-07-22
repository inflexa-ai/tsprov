import { test, expect } from "bun:test";
import { readdirSync, existsSync, statSync } from "node:fs";

// The dependency-policy eval mechanically enforces the loop's packaging rules on every
// workspace package's manifest, so a smuggled or misplaced dependency turns a test red the
// moment it lands — and future renderer packages are covered automatically (we glob
// `rendering/*`, we do not enumerate a fixed list) while the packages that exist TODAY also
// carry an exact, pinned expected dependency set.
//
// The rules (from the loop / design):
//  1. `@inflexa-ai/tsprov` is NEVER a runtime `dependency`; a renderer takes it as a
//     `peerDependency` plus a `workspace:*` dev link, nothing else.
//  2. A rendering package's regular dependencies may include rendering SIBLINGS
//     (`@inflexa-ai/tsprov-render-*`, value-semantic family code) and its ONE sanctioned
//     heavy dependency, and nothing else. Each existing package's exact set is pinned below.
//  3. The only heavy runtime deps ever allowed are `@dagrejs/dagre` (svg — its single
//     owner; interactive reuses svg's layout seam rather than dagre directly) and
//     `@hpcc-js/wasm-graphviz` (graphviz, as a peer) — each only in the package it names.
//  4. The core package itself depends on `luxon` only.

const TSPROV = "@inflexa-ai/tsprov";
const RENDER_CORE = "@inflexa-ai/tsprov-render-core";
const RENDER_SVG = "@inflexa-ai/tsprov-render-svg";
const DAGRE = "@dagrejs/dagre";
const RENDERING_DIR = `${import.meta.dir}/..`;
const CORE_PKG_PATH = `${import.meta.dir}/../../packages/tsprov/package.json`;

// The EXACT regular-`dependencies` key set each existing rendering package may declare —
// pinned per package so a mechanical `toEqual` names the offender on any drift.
const EXPECTED_DEPS: Record<string, readonly string[]> = {
  [RENDER_CORE]: [],
  "@inflexa-ai/tsprov-render-dot": [RENDER_CORE],
  "@inflexa-ai/tsprov-render-mermaid": [RENDER_CORE],
  "@inflexa-ai/tsprov-render-svg": [DAGRE, RENDER_CORE],
  "@inflexa-ai/tsprov-render-interactive": [RENDER_CORE, RENDER_SVG],
};

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

// The only heavy runtime deps the loop sanctions, each pinned to the renderer whose package
// name contains one of these tokens, in the stated dependency field. dagre's single owner is
// the svg renderer; interactive consumes svg's `layoutScene` seam, not dagre directly.
const APPROVED_HEAVY_DEPS: Record<
  string,
  { readonly field: "dependencies" | "peerDependencies"; readonly nameTokens: readonly string[] }
> = {
  [DAGRE]: { field: "dependencies", nameTokens: ["svg"] },
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

/** A dependency is a permitted rendering sibling: another `render-*` family package. */
function isSibling(dep: string, selfName: string): boolean {
  return dep.startsWith("@inflexa-ai/tsprov-render-") && dep !== selfName;
}

test("the core package depends on luxon only", async () => {
  const core = await readManifest(CORE_PKG_PATH);
  expect(core.name).toBe(TSPROV);
  expect(Object.keys(core.dependencies ?? {}).sort()).toEqual(["luxon"]);
});

test("each rendering package declares EXACTLY its pinned dependency set", async () => {
  const packages = await loadRenderingPackages();
  for (const key of Object.keys(EXPECTED_DEPS)) {
    const pkg = packages.find((p) => p.manifest.name === key);
    if (pkg === undefined) throw new Error(`expected rendering package not found: ${key}`);
    const actual = Object.keys(pkg.manifest.dependencies ?? {}).sort();
    const expected = [...(EXPECTED_DEPS[key] ?? [])].sort();
    expect(`${key} deps: ${actual.join(",")}`).toBe(`${key} deps: ${expected.join(",")}`);
  }
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

test("every rendering runtime dependency is a permitted sibling or a loop-approved heavy dep", async () => {
  for (const { label, manifest } of await loadRenderingPackages()) {
    const name = manifest.name ?? label;
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      // A `render-*` sibling is value-semantic family code, a permitted regular dependency of
      // any OTHER renderer package (a package must not depend on itself).
      const siblingAllowed = isSibling(dep, name);
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
  const renderCore = packages.find((p) => p.manifest.name === RENDER_CORE);
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
