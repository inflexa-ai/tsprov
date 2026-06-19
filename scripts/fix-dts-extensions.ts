#!/usr/bin/env bun
// Post-build: add `.js` extensions to the relative import/export specifiers in the
// emitted `dist/**/*.d.ts` files, so the published declarations resolve under
// `moduleResolution: nodenext` / `node16` (which otherwise fails with TS2834,
// "relative import paths need explicit file extensions").
//
// WHY this is needed and safe:
//   - Source imports stay extensionless (CLAUDE.md; `allowImportingTsExtensions:
//     false` in the declaration build), so `tsc` emits extensionless `.d.ts`.
//   - The runtime JS is bundled to a single `dist/index.js`/`.cjs` — those files
//     have no relative imports, so this rewrite never affects runtime; it only
//     repairs the type-resolution graph that the multi-file `.d.ts` exposes.
//   - In a `.d.ts`, a `.js` specifier resolves to its sibling `.d.ts` under
//     nodenext — exactly the declaration `tsc` emitted next to it. Every relative
//     specifier here points to a file (the package has no barrels but `index.ts`),
//     so appending `.js` is always correct.

import { Glob } from "bun";

// Relative (`./` or `../`) specifiers in `… from "x"` and `import("x")` positions.
const RELATIVE_SPECIFIER = /(\bfrom\s*["']|\bimport\(\s*["'])(\.\.?\/[^"']+?)(["'])/g;

/** Appends `.js` to extensionless relative specifiers; returns the new text + count. */
function addJsExtensions(source: string): { text: string; count: number } {
  let count = 0;
  const text = source.replace(
    RELATIVE_SPECIFIER,
    (match: string, prefix: string, spec: string, quote: string): string => {
      // Leave anything that already carries a module extension untouched.
      if (/\.([cm]?[jt]sx?|json)$/i.test(spec)) {
        return match;
      }
      count += 1;
      return `${prefix}${spec}.js${quote}`;
    },
  );
  return { text, count };
}

const glob = new Glob("**/*.d.ts");
let filesChanged = 0;
let total = 0;

for await (const relPath of glob.scan("dist")) {
  const path = `dist/${relPath}`;
  const original = await Bun.file(path).text();
  const { text, count } = addJsExtensions(original);
  if (count > 0) {
    await Bun.write(path, text);
    filesChanged += 1;
    total += count;
  }
}

console.log(
  `fix-dts-extensions: added .js to ${total} relative specifier(s) across ${filesChanged} file(s)`,
);
