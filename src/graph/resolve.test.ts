import { test, expect, describe } from "bun:test";

import { ProvDocument } from "../document.js";
import { ProvEntity, ProvActivity, ProvElement } from "../record/element.js";
import { ProvGeneration } from "../record/relation.js";
import { Identifier, type QualifiedName } from "../identifier.js";
import { Literal } from "../literal.js";
import type { ProvRecord } from "../record/record.js";
import { provToGraph } from "./graph.js";
import {
  resolve,
  resolveUnique,
  normalizeAttrValue,
  type Resolution,
  type UniqueResolution,
} from "./resolve.js";

/** Resolves a `prefix:local` candidate to its QName against a document's namespaces. */
function qnOf(doc: ProvDocument, candidate: string): QualifiedName {
  const qn = doc.validQualifiedName(candidate);
  if (qn === null) {
    throw new Error(`could not resolve ${candidate}`);
  }
  return qn;
}

/** The full URI a `prefix:local` candidate expands to. */
function uriOf(doc: ProvDocument, candidate: string): string {
  return qnOf(doc, candidate).uri;
}

/** A document with the `ex:` prefix registered — the base for the hand-built fixtures. */
function exDoc(): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace("ex", "http://example.org/");
  return doc;
}

// ── Outcome narrowing helpers (the unions are the whole point, so assert them). ──

function assertMatched(outcome: Resolution): readonly ProvRecord[] {
  if (outcome.kind !== "matched") {
    throw new Error(`expected matched, got ${outcome.kind}`);
  }
  return outcome.records;
}

function assertNotFoundSample(
  outcome: Resolution | UniqueResolution,
): readonly QualifiedName[] {
  if (outcome.kind !== "not-found") {
    throw new Error(`expected not-found, got ${outcome.kind}`);
  }
  return outcome.sample;
}

function assertResolved(outcome: UniqueResolution): ProvRecord {
  if (outcome.kind !== "resolved") {
    throw new Error(`expected resolved, got ${outcome.kind}`);
  }
  return outcome.record;
}

function assertAmbiguous(outcome: UniqueResolution): readonly ProvRecord[] {
  if (outcome.kind !== "ambiguous") {
    throw new Error(`expected ambiguous, got ${outcome.kind}`);
  }
  return outcome.candidates;
}

describe("resolve — selector composition (AND)", () => {
  // Spec: "Composed criteria narrow conjunctively".
  test("idPrefix and type compose conjunctively", () => {
    const doc = exDoc();
    doc.addNamespace("other", "http://other.org/");
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.activity("ex:a1"); // same uri prefix, excluded by type
    doc.entity("other:x"); // an entity, but outside the uri prefix

    const g = provToGraph(doc);
    const records = assertMatched(
      resolve(g, { idPrefix: "http://example.org/", type: ProvEntity }),
    );
    expect(records.map((r) => r.identifier?.uri).sort()).toEqual(
      [uriOf(doc, "ex:e1"), uriOf(doc, "ex:e2")].sort(),
    );
  });

  // Spec: "A prefixed-form id resolves via the document's namespaces".
  test("a prefixed-form id resolves via the document's namespaces", () => {
    const doc = exDoc();
    doc.entity("ex:e1");

    const g = provToGraph(doc);
    const records = assertMatched(resolve(g, { id: "ex:e1" }));
    expect(records.length).toBe(1);
    expect(records[0]?.identifier?.uri).toBe(uriOf(doc, "ex:e1"));
  });

  // Spec: "A relation is a legal query subject".
  test("a relation with an identifier is a legal query subject", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e1", "ex:a1", undefined, "ex:gen1");

    const g = provToGraph(doc);
    const records = assertMatched(resolve(g, { id: "ex:gen1" }));
    expect(records.length).toBe(1);
    expect(records[0]).toBeInstanceOf(ProvGeneration);
  });

  // Spec: "The injected predicate composes with built-ins".
  test("the injected where predicate composes with type", () => {
    const doc = exDoc();
    doc.entity("ex:keep");
    doc.entity("ex:drop");
    doc.activity("ex:a1"); // where would accept it, but type rejects it

    const g = provToGraph(doc);
    const records = assertMatched(
      resolve(g, {
        type: ProvEntity,
        where: (r) => r.identifier?.localpart !== "drop",
      }),
    );
    expect(records.length).toBe(1);
    expect(records[0]?.identifier?.localpart).toBe("keep");
  });

  // Spec: "Inferred graph nodes are not resolvable" — and the substrate invariant
  // that an inferred synthetic is never an asserted record of the document.
  test("inferred graph nodes are not resolvable and absent from document.getRecords()", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.wasGeneratedBy("ex:e1", "ex:ghost"); // ex:ghost activity never declared

    const g = provToGraph(doc);
    const ghost = uriOf(doc, "ex:ghost");
    // The inference happened on the graph...
    expect(g.getNode(ghost)?.inferred).toBe(true);
    // ...but the synthetic is not an asserted record...
    expect(
      g.document.getRecords().some((r) => r.identifier?.uri === ghost),
    ).toBe(false);
    // ...so it cannot be resolved.
    expect(resolve(g, { id: "ex:ghost" }).kind).toBe("not-found");
  });

  test("an empty selector matches every record", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e1", "ex:a1");

    const g = provToGraph(doc);
    const records = assertMatched(resolve(g, {}));
    expect(records.map((r) => r.key)).toEqual(
      g.document.getRecords().map((r) => r.key),
    );
  });

  test("a blank-identifier record is matchable by type and attribute, not by id", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    // A generation with a null identifier carrying a non-formal attribute.
    doc.wasGeneratedBy("ex:e1", "ex:a1", undefined, null, { "ex:role": "primary" });

    const g = provToGraph(doc);
    const matched = assertMatched(
      resolve(g, {
        type: ProvGeneration,
        attributes: [{ name: "ex:role", equals: "primary" }],
      }),
    );
    expect(matched.length).toBe(1);
    expect(matched[0]).toBeInstanceOf(ProvGeneration);
    expect(matched[0]?.identifier).toBeNull();

    // The same blank relation fails an identifier criterion.
    expect(
      resolve(g, { type: ProvGeneration, idIncludes: "example" }).kind,
    ).toBe("not-found");
  });
});

describe("resolve — attribute predicates", () => {
  // Spec: "A hash prefix resolves via startsWith".
  test("a hash prefix resolves via startsWith", () => {
    const doc = exDoc();
    doc.entity("ex:e1", { "ex:hash": "abc123def456" });

    const g = provToGraph(doc);
    const records = assertMatched(
      resolve(g, { attributes: [{ name: "ex:hash", startsWith: "abc123" }] }),
    );
    expect(records.length).toBe(1);
    expect(records[0]?.identifier?.uri).toBe(uriOf(doc, "ex:e1"));
  });

  // Spec: "A QName-valued attribute matches by uri and by display form".
  test("a QName-valued attribute matches by uri and by display form", () => {
    const doc = exDoc();
    doc.collection("ex:c1"); // asserts prov:type = prov:Collection (a QName value)

    const g = provToGraph(doc);
    const byUri = assertMatched(
      resolve(g, {
        attributes: [{ name: "prov:type", equals: uriOf(doc, "prov:Collection") }],
      }),
    );
    const byDisplay = assertMatched(
      resolve(g, {
        attributes: [{ name: "prov:type", equals: "prov:Collection" }],
      }),
    );
    expect(byUri.length).toBe(1);
    expect(byDisplay.length).toBe(1);
    // Both forms resolve to the very same record instance.
    expect(byUri[0]).toBe(byDisplay[0]);
  });

  // Spec: "Multi-valued attributes match on any value".
  test("multi-valued attributes match on any value", () => {
    const doc = exDoc();
    doc.entity("ex:e1", { "ex:tag": ["raw", "published"] });

    const g = provToGraph(doc);
    const records = assertMatched(
      resolve(g, { attributes: [{ name: "ex:tag", equals: "published" }] }),
    );
    expect(records.length).toBe(1);
  });

  test("includes matches an interior substring", () => {
    const doc = exDoc();
    doc.entity("ex:e1", { "ex:path": "/data/reports/q1.csv" });

    const g = provToGraph(doc);
    const records = assertMatched(
      resolve(g, { attributes: [{ name: "ex:path", includes: "reports" }] }),
    );
    expect(records.length).toBe(1);
  });

  test("an unresolvable attribute name matches nothing (not-found)", () => {
    const doc = exDoc();
    doc.entity("ex:e1", { "ex:hash": "abc" });

    const g = provToGraph(doc);
    // `nope:` is not a registered prefix, so the name cannot resolve.
    expect(
      resolve(g, { attributes: [{ name: "nope:hash", equals: "abc" }] }).kind,
    ).toBe("not-found");
  });
});

describe("resolve — outcome contract", () => {
  // Spec: "All matches are returned in document order".
  test("all matches are returned in document order", () => {
    const doc = new ProvDocument();
    doc.addNamespace("a", "http://a.org/");
    doc.addNamespace("b", "http://b.org/");
    doc.addNamespace("c", "http://c.org/");
    doc.entity("a:report");
    doc.entity("b:report");
    doc.entity("c:report");

    const g = provToGraph(doc);
    const records = assertMatched(resolve(g, { localpart: "report" }));
    expect(records.map((r) => r.identifier?.uri)).toEqual([
      uriOf(doc, "a:report"),
      uriOf(doc, "b:report"),
      uriOf(doc, "c:report"),
    ]);
  });

  // Spec: "A miss orients the caller".
  test("a miss returns a bounded orientation sample", () => {
    const doc = exDoc();
    for (let i = 0; i < 40; i += 1) {
      doc.entity(`ex:e${i}`);
    }

    const g = provToGraph(doc);
    const sample = assertNotFoundSample(resolve(g, { id: "ex:nope" }));
    expect(sample.length).toBe(10);
    const known = new Set(
      g.document.getRecords(ProvElement).map((e) => e.identifier?.uri),
    );
    expect(sample.every((id) => known.has(id.uri))).toBe(true);
  });

  test("the not-found sample lists elements before relations", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e1", "ex:a1", undefined, "ex:gen1"); // a relation WITH an id

    const g = provToGraph(doc);
    const sample = assertNotFoundSample(resolve(g, { id: "ex:nope" }));
    // Elements first: the two element ids precede the relation id.
    expect(sample.map((id) => id.uri)).toEqual([
      uriOf(doc, "ex:e1"),
      uriOf(doc, "ex:a1"),
      uriOf(doc, "ex:gen1"),
    ]);
  });
});

describe("resolveUnique", () => {
  // Spec: "Uniqueness violations list candidates instead of guessing".
  test("more than one match is ambiguous with all candidates", () => {
    const doc = new ProvDocument();
    doc.addNamespace("a", "http://a.org/");
    doc.addNamespace("b", "http://b.org/");
    doc.entity("a:report");
    doc.entity("b:report");

    const g = provToGraph(doc);
    const candidates = assertAmbiguous(resolveUnique(g, { localpart: "report" }));
    expect(candidates.length).toBe(2);
  });

  // Spec: "A unique match resolves".
  test("exactly one match resolves", () => {
    const doc = exDoc();
    doc.entity("ex:only");
    doc.activity("ex:a1");

    const g = provToGraph(doc);
    const record = assertResolved(resolveUnique(g, { id: "ex:only" }));
    expect(record.identifier?.uri).toBe(uriOf(doc, "ex:only"));
  });

  test("no match is not-found", () => {
    const doc = exDoc();
    doc.entity("ex:e1");

    const g = provToGraph(doc);
    expect(resolveUnique(g, { id: "ex:absent" }).kind).toBe("not-found");
  });
});

// The inf-cli PR #72 `resolveFileRef` adapter — path (exact) / hash (unique
// prefix) / git-style ambiguity — expressed entirely with built-ins, proving the
// consumer needs no library change (task 2.2).
describe("PR #72 resolveFileRef shape", () => {
  test("path-equals resolves, unique hash-prefix resolves, shared prefix is ambiguous", () => {
    const doc = new ProvDocument();
    doc.addNamespace("inf", "http://inflexa.ai/");
    doc.entity("inf:fileA", {
      "inf:path": "/data/a.csv",
      "inf:hash": "abc123deadbeef",
    });
    doc.entity("inf:fileB", {
      "inf:path": "/data/b.csv",
      "inf:hash": "abcdef00cafe",
    });

    const g = provToGraph(doc);

    // Path is exact and unique.
    const byPath = assertResolved(
      resolveUnique(g, { attributes: [{ name: "inf:path", equals: "/data/a.csv" }] }),
    );
    expect(byPath.identifier?.uri).toBe(uriOf(doc, "inf:fileA"));

    // A hash prefix shared by both files is ambiguous — git's "list candidates".
    const shared = assertAmbiguous(
      resolveUnique(g, { attributes: [{ name: "inf:hash", startsWith: "abc" }] }),
    );
    expect(shared.length).toBe(2);

    // A longer, discriminating prefix resolves.
    const byHash = assertResolved(
      resolveUnique(g, { attributes: [{ name: "inf:hash", startsWith: "abc123" }] }),
    );
    expect(byHash.identifier?.uri).toBe(uriOf(doc, "inf:fileA"));
  });
});

describe("normalizeAttrValue", () => {
  test("a QualifiedName yields its uri and its prefix:localpart display", () => {
    const doc = exDoc();
    const qn = qnOf(doc, "ex:thing");
    expect(normalizeAttrValue(qn)).toEqual([qn.uri, "ex:thing"]);
  });

  test("a Literal yields its lexical value", () => {
    expect(normalizeAttrValue(new Literal("hello"))).toEqual(["hello"]);
  });

  test("a bare Identifier yields its uri", () => {
    expect(normalizeAttrValue(new Identifier("http://x.org/thing"))).toEqual([
      "http://x.org/thing",
    ]);
  });

  test("primitives yield their string form", () => {
    expect(normalizeAttrValue(42)).toEqual(["42"]);
    expect(normalizeAttrValue(true)).toEqual(["true"]);
    expect(normalizeAttrValue("plain")).toEqual(["plain"]);
  });
});
