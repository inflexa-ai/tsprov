import { test, expect, describe } from "bun:test";

import { ProvDocument } from "../document.js";
import { ProvNSerializer } from "./provn.js";
import {
  getSerializer,
  registeredFormats,
  DoNotExist,
  UnsupportedOperationError,
} from "./serializer.js";

function sampleDoc(): ProvDocument {
  const d = new ProvDocument();
  d.addNamespace("ex", "http://example.org/");
  const e = d.entity("ex:report");
  const a = d.activity(
    "ex:write",
    "2024-01-01T09:00:00+00:00",
    "2024-01-01T09:05:00+00:00",
  );
  d.wasGeneratedBy(e, a, "2024-01-01T09:05:00+00:00");
  return d;
}

// Both expected strings are the exact output of Python `doc.get_provn()` from
// the reference interpreter.
const DOC_PROVN =
  "document\n" +
  "  prefix ex <http://example.org/>\n" +
  "  \n" +
  "  entity(ex:report)\n" +
  "  activity(ex:write, 2024-01-01T09:00:00+00:00, 2024-01-01T09:05:00+00:00)\n" +
  "  wasGeneratedBy(ex:report, ex:write, 2024-01-01T09:05:00+00:00)\n" +
  "endDocument";

describe("container getProvN", () => {
  test("a document matches Python's get_provn byte-for-byte", () => {
    expect(sampleDoc().getProvN()).toBe(DOC_PROVN);
  });

  test("nested bundles are framed and indented like Python", () => {
    const d = sampleDoc();
    const b = d.bundle("ex:b1");
    b.entity("ex:nested");
    expect(d.getProvN()).toBe(
      DOC_PROVN.replace(
        "\nendDocument",
        "\n  bundle ex:b1\n    entity(ex:nested)\n  endBundle\nendDocument",
      ),
    );
  });
});

describe("PROV-N serializer", () => {
  test("serialize delegates to getProvN", () => {
    const d = sampleDoc();
    expect(d.serialize("provn")).toBe(d.getProvN());
    expect(new ProvNSerializer().serialize(d)).toBe(d.getProvN());
  });

  test("deserialize is unsupported", () => {
    expect(() => ProvDocument.deserialize("anything", "provn")).toThrow(
      UnsupportedOperationError,
    );
  });
});

describe("serializer registry", () => {
  test("provn is registered", () => {
    expect(registeredFormats()).toContain("provn");
    expect(getSerializer("provn")).toBeInstanceOf(ProvNSerializer);
  });

  test("an unknown format throws DoNotExist", () => {
    expect(() => getSerializer("nope")).toThrow(DoNotExist);
    expect(() => new ProvDocument().serialize("nope")).toThrow(DoNotExist);
  });
});
