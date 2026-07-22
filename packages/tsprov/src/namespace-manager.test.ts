import { test, expect, describe } from "bun:test";

import { NamespaceManager } from "./namespace-manager.js";
import { Namespace, Identifier } from "./identifier.js";
import { PROV } from "./constants.js";

describe("NamespaceManager defaults & registration", () => {
  test("starts with the prov/xsd/xsi namespaces", () => {
    const nm = new NamespaceManager();
    expect(nm.getNamespace("http://www.w3.org/ns/prov#")).toBe(PROV);
    expect(nm.getRegisteredNamespaces()).toEqual([]); // defaults are not "registered"
  });

  test("addNamespace registers and is resolvable; returns the effective namespace", () => {
    const nm = new NamespaceManager();
    const ex = nm.addNamespace(new Namespace("ex", "http://example.org/"));
    expect(ex.prefix).toBe("ex");
    expect(nm.getNamespace("http://example.org/")).toBe(ex);
    expect(nm.getRegisteredNamespaces()).toHaveLength(1);
  });

  test("constructor accepts a {prefix: uri} map", () => {
    const nm = new NamespaceManager({ ex: "http://example.org/" });
    expect(nm.validQualifiedName("ex:foo")!.uri).toBe("http://example.org/foo");
  });
});

describe("addNamespace dedup & rename", () => {
  test("a duplicate URI under a new prefix is deduped to the existing namespace", () => {
    const nm = new NamespaceManager();
    const ex = nm.addNamespace(new Namespace("ex", "http://example.org/"));
    const other = nm.addNamespace(new Namespace("other", "http://example.org/"));
    expect(other).toBe(ex); // same URI → reuse
    // The renamed prefix now resolves to the existing namespace.
    expect(nm.validQualifiedName("other:foo")!.uri).toBe("http://example.org/foo");
  });

  test("a conflicting prefix with a new URI is renamed", () => {
    const nm = new NamespaceManager();
    nm.addNamespace(new Namespace("ex", "http://example.org/"));
    const ex2 = nm.addNamespace(new Namespace("ex", "http://elsewhere.org/"));
    expect(ex2.prefix).toBe("ex_1");
    expect(ex2.uri).toBe("http://elsewhere.org/");
  });
});

describe("validQualifiedName — strings & identifiers", () => {
  test("prefix:local against a registered prefix", () => {
    const nm = new NamespaceManager();
    nm.addNamespace(new Namespace("ex", "http://example.org/"));
    const qn = nm.validQualifiedName("ex:report")!;
    expect(qn.uri).toBe("http://example.org/report");
    expect(String(qn)).toBe("ex:report");
  });

  test("an Identifier is resolved by its URI", () => {
    const nm = new NamespaceManager();
    nm.addNamespace(new Namespace("ex", "http://example.org/"));
    expect(nm.validQualifiedName(new Identifier("ex:foo"))!.uri).toBe(
      "http://example.org/foo",
    );
  });

  test("a blank-node id (_:) is rejected", () => {
    expect(new NamespaceManager().validQualifiedName("_:b0")).toBeNull();
  });

  test("an unknown prefix / un-compactable URI fails", () => {
    expect(
      new NamespaceManager().validQualifiedName("http://unknown.org/x"),
    ).toBeNull();
  });

  test("a full URI is compacted against a registered namespace", () => {
    const nm = new NamespaceManager();
    nm.addNamespace(new Namespace("ex", "http://example.org/"));
    const qn = nm.validQualifiedName("http://example.org/report")!;
    expect(String(qn)).toBe("ex:report");
  });

  test("empty / nullish input returns null", () => {
    const nm = new NamespaceManager();
    expect(nm.validQualifiedName("")).toBeNull();
    expect(nm.validQualifiedName(null)).toBeNull();
    expect(nm.validQualifiedName(undefined)).toBeNull();
  });
});

describe("default namespace", () => {
  test("a bare name resolves into the default namespace", () => {
    const nm = new NamespaceManager();
    nm.setDefaultNamespace("http://example.org/");
    const qn = nm.validQualifiedName("report")!;
    expect(qn.uri).toBe("http://example.org/report");
    expect(String(qn)).toBe("report"); // empty prefix → bare display
  });

  test("a prefix-less QualifiedName adopts/uses the default namespace", () => {
    const nm = new NamespaceManager();
    const defaultNs = new Namespace("", "http://example.org/");
    // No default yet → the given namespace becomes the default, qname returned as-is.
    const qn = defaultNs.qn("e");
    expect(nm.validQualifiedName(qn)).toBe(qn);
    expect(nm.getDefaultNamespace()!.uri).toBe("http://example.org/");
  });
});

describe("anonymous identifiers", () => {
  test("are sequential blank-node ids", () => {
    const nm = new NamespaceManager();
    expect(nm.getAnonymousIdentifier().uri).toBe("_:id1");
    expect(nm.getAnonymousIdentifier().uri).toBe("_:id2");
    expect(nm.getAnonymousIdentifier("x").uri).toBe("_:x3");
  });
});

describe("parent delegation", () => {
  test("resolution falls back to the parent manager", () => {
    const parent = new NamespaceManager();
    parent.addNamespace(new Namespace("ex", "http://example.org/"));
    const child = new NamespaceManager(null, null, parent);
    // child has no 'ex' prefix; it delegates to the parent.
    expect(child.validQualifiedName("ex:foo")!.uri).toBe(
      "http://example.org/foo",
    );
  });
});
