import { test, expect, describe } from "bun:test";

import { ProvDocument } from "./document";
import { ProvBundle } from "./bundle";

function exDoc(): ProvDocument {
  const d = new ProvDocument();
  d.addNamespace("ex", "http://example.org/");
  return d;
}

describe("ProvDocument basics", () => {
  test("is a document, not a bundle", () => {
    const d = new ProvDocument();
    expect(d).toBeInstanceOf(ProvBundle);
    expect(d.isDocument()).toBe(true);
    expect(d.isBundle()).toBe(false);
    expect(d.hasBundles()).toBe(false);
  });

  test("inherits the fluent builder API", () => {
    const d = exDoc();
    const e = d.entity("ex:report");
    expect(e.getProvN()).toBe("entity(ex:report)");
    expect(d.records).toHaveLength(1);
  });
});

describe("sub-bundles", () => {
  test("bundle() creates a named child linked back to the document", () => {
    const d = exDoc();
    const b = d.bundle("ex:b1");
    expect(b).toBeInstanceOf(ProvBundle);
    expect(b.identifier!.uri).toBe("http://example.org/b1");
    expect(b.document).toBe(d);
    expect(d.hasBundles()).toBe(true);
    expect(d.bundles).toEqual([b]);
  });

  test("a child bundle inherits the document's namespaces via its parent", () => {
    const d = exDoc();
    const b = d.bundle("ex:b1");
    const e = b.entity("ex:e1"); // 'ex' is registered on the document, not the bundle
    expect(e.identifier!.uri).toBe("http://example.org/e1");
  });

  test("a duplicate bundle identifier throws", () => {
    const d = exDoc();
    d.bundle("ex:b1");
    expect(() => d.bundle("ex:b1")).toThrow();
  });

  test("an unnamed bundle throws", () => {
    // @ts-expect-error — exercising the runtime guard
    expect(() => exDoc().bundle(null)).toThrow();
  });
});

describe("flattened", () => {
  test("returns the same document when there are no bundles", () => {
    const d = exDoc();
    d.entity("ex:e1");
    expect(d.flattened()).toBe(d); // identity (the quirk)
  });

  test("moves bundle records up to the document level", () => {
    const d = exDoc();
    d.entity("ex:top");
    const b = d.bundle("ex:b1");
    b.entity("ex:nested");
    const flat = d.flattened();
    expect(flat).not.toBe(d);
    expect(flat.hasBundles()).toBe(false);
    expect(flat.records).toHaveLength(2); // ex:top + ex:nested
    expect(flat.getRecord("ex:nested")).toHaveLength(1);
  });
});

describe("document equality", () => {
  function build(): ProvDocument {
    const d = new ProvDocument();
    d.addNamespace("ex", "http://example.org/");
    d.entity("ex:top");
    const b = d.bundle("ex:b1");
    b.entity("ex:nested");
    return d;
  }

  test("documents with equal records and equal bundles are equal", () => {
    expect(build().equals(build())).toBe(true);
  });

  test("a differing bundle breaks equality", () => {
    const d = build();
    // Add an extra record into the existing bundle.
    d.bundles[0]!.entity("ex:extra");
    expect(build().equals(d)).toBe(false);
  });

  test("a document never equals a plain bundle", () => {
    expect(new ProvDocument().equals(new ProvBundle())).toBe(false);
  });
});
