import { test, expect, describe } from "bun:test";

import { Identifier, Namespace } from "./identifier.js";
import { internNamespace, internQName, ns } from "./intern.js";

// The two-prefix-same-URI fixture from `reference/prov/src/prov/tests/attributes.py:4-5`.
// It exists precisely to pin down that QName identity ignores the prefix.
const EX = new Namespace("ex", "http://example.org/");
const EX_OTHER = new Namespace("other", "http://example.org/");

describe("Identifier", () => {
  test("stores its URI and stringifies to it", () => {
    const id = new Identifier("http://example.org/thing");
    expect(id.uri).toBe("http://example.org/thing");
    expect(id.toString()).toBe("http://example.org/thing");
    expect(`${id}`).toBe("http://example.org/thing");
  });

  test("equality is by URI only and rejects non-identifiers", () => {
    const a = new Identifier("http://x/1");
    const b = new Identifier("http://x/1");
    const c = new Identifier("http://x/2");
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a.equals("http://x/1")).toBe(false); // a bare string is not an Identifier
    expect(a.equals(null)).toBe(false);
    expect(a.equals(undefined)).toBe(false);
  });

  test("key folds in the class (so it never collides with a QName key)", () => {
    expect(new Identifier("http://x/1").key).toBe("I\u0000http://x/1");
  });

  test("PROV-N representation is a quoted xsd:anyURI literal", () => {
    expect(new Identifier("http://x/1").provnRepresentation()).toBe(
      '"http://x/1" %% xsd:anyURI',
    );
  });
});

describe("QualifiedName", () => {
  test("URI is namespace URI + localpart; components are exposed", () => {
    const qn = EX.qn("report");
    expect(qn.uri).toBe("http://example.org/report");
    expect(qn.localpart).toBe("report");
    expect(qn.namespace).toBe(EX);
  });

  test("display form is prefix:localpart, or bare localpart for an empty prefix", () => {
    expect(String(EX.qn("report"))).toBe("ex:report");
    const def = new Namespace("", "http://default/");
    expect(String(def.qn("report"))).toBe("report");
  });

  test("key is the bare URI — prefix-independent (the crux)", () => {
    expect(EX.qn("foo").key).toBe("http://example.org/foo");
    // Different prefix, same URI → equal value, equal key, but different display.
    expect(EX.qn("foo").equals(EX_OTHER.qn("foo"))).toBe(true);
    expect(EX.qn("foo").key).toBe(EX_OTHER.qn("foo").key);
    expect(String(EX.qn("foo"))).toBe("ex:foo");
    expect(String(EX_OTHER.qn("foo"))).toBe("other:foo");
  });

  test("qn() memoizes per namespace instance", () => {
    expect(EX.qn("x")).toBe(EX.qn("x"));
  });

  test("a QName equals an Identifier of the same URI, yet keys differ", () => {
    const qn = EX.qn("foo");
    const id = new Identifier("http://example.org/foo");
    expect(qn.equals(id)).toBe(true); // inherited URI equality
    expect(id.equals(qn)).toBe(true); // symmetric
    expect(qn.key).not.toBe(id.key); // but distinct dict slots (class folded for Identifier)
    expect(qn.key).toBe("http://example.org/foo");
    expect(id.key).toBe("I\u0000http://example.org/foo");
  });

  test("PROV-N representation is the single-quoted display form", () => {
    expect(EX.qn("Entity").provnRepresentation()).toBe("'ex:Entity'");
  });

  test("string keys dedup equal QNames in a Map (reference keying would not)", () => {
    const m = new Map<string, number>();
    m.set(EX.qn("foo").key, 1);
    // Looked up by a different-but-equal instance — this is what reference keys break.
    expect(m.get(EX_OTHER.qn("foo").key)).toBe(1);
  });
});

describe("Namespace", () => {
  test("exposes prefix and uri", () => {
    expect(EX.prefix).toBe("ex");
    expect(EX.uri).toBe("http://example.org/");
  });

  test("rejects empty or whitespace-only URIs", () => {
    expect(() => new Namespace("ex", "")).toThrow(
      "Not a valid URI to create a namespace.",
    );
    expect(() => new Namespace("ex", "   ")).toThrow(
      "Not a valid URI to create a namespace.",
    );
  });

  test("equality INCLUDES the prefix (deliberately unlike QName)", () => {
    expect(EX.equals(EX_OTHER)).toBe(false); // same URI, different prefix
    expect(EX.equals(new Namespace("ex", "http://example.org/"))).toBe(true);
    expect(EX.equals("ex")).toBe(false);
  });

  test("key folds in both prefix and uri", () => {
    expect(EX.key).toBe("ex\u0000http://example.org/");
    expect(EX_OTHER.key).toBe("other\u0000http://example.org/");
    expect(EX.key).not.toBe(EX_OTHER.key);
  });

  test("contains() tests URI prefixing for strings and identifiers", () => {
    expect(EX.contains("http://example.org/foo")).toBe(true);
    expect(EX.contains(new Identifier("http://example.org/foo"))).toBe(true);
    expect(EX.contains("http://other.org/foo")).toBe(false);
  });

  test("qname() reverse-resolves a URI back to a QName, or null", () => {
    const qn = EX.qname("http://example.org/foo");
    expect(qn).not.toBeNull();
    expect(qn!.localpart).toBe("foo");
    expect(qn!.namespace).toBe(EX);
    expect(EX.qname("http://other.org/foo")).toBeNull();
  });
});

describe("intern", () => {
  test("ns()/internNamespace() return the same instance for equal (prefix, uri)", () => {
    const a = ns("ex", "http://example.org/");
    const b = ns("ex", "http://example.org/");
    expect(a).toBe(b); // identical reference
    expect(internNamespace("ex", "http://example.org/")).toBe(a);
  });

  test("interning distinguishes prefix and uri", () => {
    const base = ns("ex", "http://example.org/");
    expect(ns("other", "http://example.org/")).not.toBe(base); // prefix differs
    expect(ns("ex", "http://elsewhere.org/")).not.toBe(base); // uri differs
  });

  test("interned namespaces make their QNames === (constants are singletons)", () => {
    const PROV = ns("prov", "http://www.w3.org/ns/prov#");
    const PROV_ENTITY = PROV.qn("Entity");
    expect(PROV_ENTITY).toBe(PROV.qn("Entity")); // singleton, like PROV_ENTITY === PROV.qn('Entity')
  });

  test("internQName() unifies equal-URI QNames from different namespace instances", () => {
    // Two distinct Namespace objects with the same URI but different prefixes.
    const n1 = new Namespace("ex", "http://example.org/");
    const n2 = new Namespace("other", "http://example.org/");
    const canonical = internQName(n1.qn("foo"));
    expect(internQName(n2.qn("foo"))).toBe(canonical); // first seen wins
    expect(internQName(canonical)).toBe(canonical); // idempotent
  });
});
