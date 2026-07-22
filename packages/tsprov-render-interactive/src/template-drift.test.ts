import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildGeneratedSource, readTemplates } from "../scripts/generate-template.mjs";

// The drift guard: the committed `src/template.generated.ts` is produced from the authored
// `template/{shell.html,style.css,app.js}` by the codegen script. Here we regenerate the
// module IN MEMORY from the current sources and byte-compare it to the committed file, so
// editing a template without running `bun run gen` turns this test red. That is what lets
// the client be authored as real files while the build/publish path consumes plain TS.

const GENERATED = join(import.meta.dir, "template.generated.ts");

test("the committed template module matches a fresh generation (no drift)", () => {
  const expected = buildGeneratedSource(readTemplates());
  const committed = readFileSync(GENERATED, "utf8");
  expect(committed).toBe(expected);
});

test("the generated module carries the do-not-edit header naming the generator", () => {
  const committed = readFileSync(GENERATED, "utf8");
  expect(committed.startsWith("// GENERATED FILE — DO NOT EDIT BY HAND.")).toBe(true);
  expect(committed).toContain("scripts/generate-template.mjs");
});
