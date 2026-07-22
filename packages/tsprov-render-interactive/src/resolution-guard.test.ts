import { test, expect } from "bun:test";

// render-interactive takes tsprov as a peer + `workspace:*` dev link, and render-core AND
// render-svg as regular dependencies, all of which must resolve to the SAME copies the repo
// builds — not a second copy pulled into Bun's global install cache. A stray copy would
// break cross-package `instanceof` (render-core sets an attribute's `valueUri` only when the
// value passes its OWN `instanceof Identifier`, and layoutScene's geometry must come from the
// single dagre owner). This guard fails fast if resolution ever escapes the repository.
// `@dagrejs/dagre` is owned by render-svg and intentionally NOT checked here.

test("tsprov, render-core, and render-svg resolve inside this repository, not the global cache", () => {
  const repoRoot = new URL("../../../", import.meta.url).pathname;
  for (const specifier of [
    "@inflexa-ai/tsprov",
    "@inflexa-ai/tsprov-render-core",
    "@inflexa-ai/tsprov-render-svg",
  ]) {
    const resolved = import.meta.resolve(specifier);
    // `import.meta.resolve` returns a file:// URL; decode it to a path.
    const path = decodeURIComponent(new URL(resolved).pathname);
    expect(path.startsWith(repoRoot)).toBe(true);
    expect(path).not.toContain("/.bun/install/cache");
    expect(path).not.toContain("/node_modules/.cache");
  }
});
