import { test, expect } from "bun:test";

// The whole point of the peer + `workspace:*` dev-link setup is that render-core
// resolves the SAME tsprov instance the repo builds — not a second copy pulled into
// Bun's global install cache. A stray copy would break cross-package `instanceof`
// (the packaging eval proves the positive case). This guard fails fast if resolution
// ever escapes the repository.

test("@inflexa-ai/tsprov resolves inside this repository, not the global cache", () => {
  const resolved = import.meta.resolve("@inflexa-ai/tsprov");
  // `import.meta.resolve` returns a file:// URL; decode it to a path.
  const path = decodeURIComponent(new URL(resolved).pathname);

  const repoRoot = new URL("../../../", import.meta.url).pathname;
  expect(path.startsWith(repoRoot)).toBe(true);
  expect(path).not.toContain("/.bun/install/cache");
  expect(path).not.toContain("/node_modules/.cache");
});
