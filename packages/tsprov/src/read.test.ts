import { test, expect, describe } from "bun:test";

import { read } from "./read.js";
import { ProvDocument } from "./document.js";
// Ensure the JSON serializer is registered (the auto-detect probe needs it).
import "./serializers/json.js";

function sampleJson(): { doc: ProvDocument; json: string } {
  const doc = new ProvDocument();
  doc.addNamespace("ex", "http://example.org/");
  const e = doc.entity("ex:report");
  const a = doc.activity("ex:write");
  doc.wasGeneratedBy(e, a);
  return { doc, json: doc.serialize("json") };
}

describe("read", () => {
  test("auto-detects JSON content", () => {
    const { doc, json } = sampleJson();
    expect(read(json).equals(doc)).toBe(true);
  });

  test("honors an explicit format", () => {
    const { doc, json } = sampleJson();
    expect(read(json, "json").equals(doc)).toBe(true);
  });

  test("throws TypeError when no format can parse the content", () => {
    expect(() => read("this is not PROV in any format")).toThrow(TypeError);
  });

  test("propagates a precise error for an explicit unsupported format", () => {
    // PROV-N has no parser.
    expect(() => read("document\nendDocument", "provn")).toThrow();
  });
});
