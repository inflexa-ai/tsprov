// Codegen: compile the authored template sources into a committed TS module.
//
// The client is authored as real files under `template/` (shell.html, style.css, app.js)
// so they get editor tooling, syntax highlighting, and linting — not as thousand-line
// string literals inside a `.ts`. This script reads those three files and emits
// `src/template.generated.ts`: three exported string constants the emitter interpolates.
//
// Why a committed generated module (not a bun text-import): the package ships a `tsc`
// dual ESM+CJS build for publishing, and `tsc` cannot resolve Bun's text imports, so the
// template must be plain TS at build time. The module is committed and guarded by a drift
// test (`src/template-drift.test.ts`) that regenerates in memory and fails on any
// mismatch, so the checked-in file can never silently diverge from its sources.
//
// Escaping strategy: `JSON.stringify` turns each source into a valid double-quoted JS
// string literal (handles quotes, backslashes, newlines, unicode). Deterministic, so the
// drift test is a pure byte-compare.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(HERE, "..");
const TEMPLATE_DIR = join(PACKAGE_DIR, "template");
const OUTPUT = join(PACKAGE_DIR, "src", "template.generated.ts");

/** The three authored template sources, read as raw UTF-8. */
export function readTemplates() {
  return {
    shell: readFileSync(join(TEMPLATE_DIR, "shell.html"), "utf8"),
    style: readFileSync(join(TEMPLATE_DIR, "style.css"), "utf8"),
    app: readFileSync(join(TEMPLATE_DIR, "app.js"), "utf8"),
  };
}

/**
 * Builds the exact text of `src/template.generated.ts` from the three sources. Pure and
 * deterministic — same inputs, same bytes — so the drift test can byte-compare its output
 * against the committed module.
 */
export function buildGeneratedSource(templates) {
  const header = [
    "// GENERATED FILE — DO NOT EDIT BY HAND.",
    "//",
    "// Produced by `scripts/generate-template.mjs` (run `bun run gen`) from the authored",
    "// sources in `template/{shell.html,style.css,app.js}`. Edit those files and regenerate;",
    "// a drift test (`src/template-drift.test.ts`) fails if this module and the sources",
    "// disagree. The three constants are inlined verbatim into the emitted HTML document.",
    "",
    "/** The document shell with `__PROV_TITLE__`/`__PROV_STYLE__`/`__PROV_PAYLOAD__`/`__PROV_APP__` slots. */",
    `export const SHELL_HTML = ${JSON.stringify(templates.shell)};`,
    "",
    "/** The inline chrome stylesheet (light/dark aware; PROV glyph colors stay themed). */",
    `export const STYLE_CSS = ${JSON.stringify(templates.style)};`,
    "",
    "/** The dependency-free vanilla client that builds the SVG DOM and drives interaction. */",
    `export const APP_JS = ${JSON.stringify(templates.app)};`,
    "",
  ];
  return header.join("\n");
}

/** Regenerates and writes the committed module. Only runs when invoked directly. */
export function generate() {
  const source = buildGeneratedSource(readTemplates());
  writeFileSync(OUTPUT, source);
  return OUTPUT;
}

if (import.meta.main) {
  const path = generate();
  console.log(`wrote ${path}`);
}
