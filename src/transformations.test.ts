import { test, expect, describe } from "bun:test";

import { ProvBundle } from "./bundle";
import { ProvDocument } from "./document";

const EX = "http://example.org/";

describe("ProvBundle.unified", () => {
  test("merges records sharing an identifier", () => {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.entity("ex:e", { "ex:a": "1" });
    b.entity("ex:e", { "ex:b": "2" });
    expect(b.getRecord("ex:e")).toHaveLength(2);

    const u = b.unified();
    const merged = u.getRecord("ex:e");
    expect(merged).toHaveLength(1);
    const provn = merged[0]!.getProvN();
    expect(provn).toContain('ex:a="1"');
    expect(provn).toContain('ex:b="2"');
  });

  test("leaves distinct records untouched", () => {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.entity("ex:a");
    b.entity("ex:b");
    expect(b.unified().records).toHaveLength(2);
  });
});

describe("ProvBundle.update", () => {
  test("appends another bundle's records", () => {
    const b1 = new ProvBundle();
    b1.addNamespace("ex", EX);
    b1.entity("ex:a");
    const b2 = new ProvBundle();
    b2.addNamespace("ex", EX);
    b2.entity("ex:b");

    b1.update(b2);
    expect(b1.records).toHaveLength(2);
    expect(b1.getRecord("ex:b")).toHaveLength(1);
  });
});

describe("ProvDocument.update", () => {
  test("merges document records and same-id bundles", () => {
    function doc(top: string, nested: string): ProvDocument {
      const d = new ProvDocument();
      d.addNamespace("ex", EX);
      d.entity(top);
      d.bundle("ex:bnd").entity(nested);
      return d;
    }
    const d1 = doc("ex:x", "ex:in1");
    d1.update(doc("ex:y", "ex:in2"));

    expect(d1.records).toHaveLength(2); // ex:x + ex:y
    expect(d1.bundles).toHaveLength(1); // ex:bnd merged, not duplicated
    expect(d1.bundles[0]!.records).toHaveLength(2); // ex:in1 + ex:in2
  });
});

describe("ProvDocument.addBundle", () => {
  test("adds an external bundle under a given identifier", () => {
    const ext = new ProvBundle(null, null, { ex: EX });
    ext.entity("ex:nested");

    const d = new ProvDocument();
    d.addNamespace("ex", EX);
    d.addBundle(ext, d.mandatoryValidQname("ex:b1"));

    expect(d.hasBundles()).toBe(true);
    expect(d.bundles[0]!.identifier!.uri).toBe("http://example.org/b1");
    expect(d.bundles[0]!.getRecord("ex:nested")).toHaveLength(1);
  });

  test("rejects a duplicate bundle identifier", () => {
    const d = new ProvDocument();
    d.addNamespace("ex", EX);
    d.bundle("ex:b1");
    const ext = new ProvBundle(null, null, { ex: EX });
    expect(() => d.addBundle(ext, d.mandatoryValidQname("ex:b1"))).toThrow();
  });
});

describe("ProvDocument.unified", () => {
  test("returns a document with same-id records unified", () => {
    const d = new ProvDocument();
    d.addNamespace("ex", EX);
    d.entity("ex:e", { "ex:a": "1" });
    d.entity("ex:e", { "ex:b": "2" });

    const u = d.unified();
    expect(u).toBeInstanceOf(ProvDocument);
    expect(u.getRecord("ex:e")).toHaveLength(1);
  });
});
