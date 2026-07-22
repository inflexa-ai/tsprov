import { test, expect } from "bun:test";

// render-dot takes tsprov as a peer + `workspace:*` dev link and render-core as a
// regular dependency, all of which must resolve to the SAME copies the repo builds —
// not a second copy pulled into Bun's global install cache. A stray copy would break
// cross-package `instanceof` (an attribute's `valueUri` is set only when the value
// passes render-core's `instanceof Identifier`). This guard fails fast if resolution
// ever escapes the repository.

test("tsprov and render-core resolve inside this repository, not the global cache", () => {
  const repoRoot = new URL("../../../", import.meta.url).pathname;
  for (const specifier of ["@inflexa-ai/tsprov", "@inflexa-ai/tsprov-render-core"]) {
    const resolved = import.meta.resolve(specifier);
    // `import.meta.resolve` returns a file:// URL; decode it to a path.
    const path = decodeURIComponent(new URL(resolved).pathname);
    expect(path.startsWith(repoRoot)).toBe(true);
    expect(path).not.toContain("/.bun/install/cache");
    expect(path).not.toContain("/node_modules/.cache");
  }
});
