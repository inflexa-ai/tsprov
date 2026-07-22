import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ProvDocument } from "../document.js";
import { ProvJsonSerializer } from "./json.js";
import { getSerializer } from "./serializer.js";

describe("PROV-JSON serializer basics", () => {
  test("is registered", () => {
    expect(getSerializer("json")).toBeInstanceOf(ProvJsonSerializer);
  });

  test("round-trips a hand-built document", () => {
    const d = new ProvDocument();
    d.addNamespace("ex", "http://example.org/");
    const e = d.entity("ex:report", { "prov:type": "ex:Doc" });
    const a = d.activity("ex:write", "2024-01-01T09:00:00+00:00");
    d.wasGeneratedBy(e, a, "2024-01-01T09:05:00+00:00");
    const back = ProvDocument.deserialize(d.serialize("json"), "json");
    expect(d.equals(back)).toBe(true);
  });

  test("round-trips a document with a sub-bundle", () => {
    const d = new ProvDocument();
    d.addNamespace("ex", "http://example.org/");
    d.entity("ex:top");
    const b = d.bundle("ex:b1");
    b.entity("ex:nested");
    const back = ProvDocument.deserialize(d.serialize("json"), "json");
    expect(d.equals(back)).toBe(true);
  });
});

// The 398-file Python corpus as the round-trip oracle (timestamp-safe — never
// regenerates fixtures): parse golden → serialize → parse → assert `.equals()`.
const CORPUS_DIR = join(
  import.meta.dir,
  // The corpus is checked out at the repo root, four levels above this file
  // (packages/tsprov/src/serializers) — it is a shared, gitignored checkout, not
  // vendored into the package.
  "../../../../reference/prov/src/prov/tests/json",
);
const corpusFiles = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("PROV-JSON corpus round-trip oracle", () => {
  test("corpus is present (398 files)", () => {
    expect(corpusFiles.length).toBe(398);
  });

  for (const file of corpusFiles) {
    test(file, () => {
      const original = readFileSync(join(CORPUS_DIR, file), "utf8");
      const doc = ProvDocument.deserialize(original, "json");
      const doc2 = ProvDocument.deserialize(doc.serialize("json"), "json");
      expect(doc.equals(doc2)).toBe(true);
    });
  }
});
