import { test, expect, describe } from "bun:test";

import { ProvDocument } from "../document.js";
// Side-effect import: registers the "json" serializer. `document.ts` only
// registers PROV-N itself; the serialize/round-trip assertions here need JSON.
import "../serializers/json.js";
import { ProvEntity } from "../record/element.js";
import {
  ProvDerivation,
  ProvGeneration,
  ProvUsage,
} from "../record/relation.js";
import type { ProvRecord } from "../record/record.js";
import { provToGraph } from "./graph.js";
import { lineage, type LineageResult } from "./lineage.js";
import { toProvDocument, toFlatGraph, lineagePaths, TSPROVQ } from "./views.js";

/** Resolves a `prefix:local` candidate to its full URI against a document's namespaces. */
function uriOf(doc: ProvDocument, candidate: string): string {
  const qn = doc.validQualifiedName(candidate);
  if (qn === null) {
    throw new Error(`could not resolve ${candidate}`);
  }
  return qn.uri;
}

/** A document with the `ex:` prefix registered — the base for the hand-built fixtures. */
function exDoc(): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace("ex", "http://example.org/");
  return doc;
}

// The annotation attribute's canonical URI, built WITHOUT resolving through any
// document — resolving `tsprovq:…` via a document's `getAttribute` would
// register the namespace there as a side effect, which is exactly the
// pollution these tests must be able to assert the absence of.
const TRUNCATED_URI = TSPROVQ.qn("truncated").uri;

/** The values a record carries under `tsprovq:truncated`, as plain strings. */
function truncatedValues(record: ProvRecord | undefined): string[] {
  return (record?.attributes ?? [])
    .filter(([name]) => name.uri === TRUNCATED_URI)
    .map(([, value]) => String(value));
}

/** e2 ← a1 ← e1: a generation + usage chain (backward reads left to right). */
function chainDoc(): ProvDocument {
  const doc = exDoc();
  doc.entity("ex:e1");
  doc.entity("ex:e2");
  doc.activity("ex:a1");
  doc.wasGeneratedBy("ex:e2", "ex:a1"); // e2 -> a1
  doc.used("ex:a1", "ex:e1"); // a1 -> e1
  return doc;
}

/** A backward derivation chain e0 -> e1 -> e2 (two hops). */
function derivChainDoc(): ProvDocument {
  const doc = exDoc();
  doc.entity("ex:e0");
  doc.entity("ex:e1");
  doc.entity("ex:e2");
  doc.wasDerivedFrom("ex:e0", "ex:e1"); // e0 -> e1
  doc.wasDerivedFrom("ex:e1", "ex:e2"); // e1 -> e2
  return doc;
}

/** A derivation diamond: e4 -> {e2, e3} -> e1 (two distinct paths e4 ~> e1). */
function diamondDoc(): ProvDocument {
  const doc = exDoc();
  doc.entity("ex:e1");
  doc.entity("ex:e2");
  doc.entity("ex:e3");
  doc.entity("ex:e4");
  doc.wasDerivedFrom("ex:e4", "ex:e2");
  doc.wasDerivedFrom("ex:e4", "ex:e3");
  doc.wasDerivedFrom("ex:e2", "ex:e1");
  doc.wasDerivedFrom("ex:e3", "ex:e1");
  return doc;
}

describe("toProvDocument — emission (spec: a walk result materializes as a standalone PROV document)", () => {
  // Scenario: A backward walk becomes a serializable document.
  test("a backward walk over e2 ← a1 ← e1 serializes to both formats and round-trips through PROV-JSON", () => {
    const doc = chainDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e2");

    const { document, closureAdded } = toProvDocument(g, result);

    // e2, a1, e1 and both relations are present; nothing was pulled (the walk
    // already covered every reference).
    expect(document.getRecord("ex:e1").length).toBe(1);
    expect(document.getRecord("ex:e2").length).toBe(1);
    expect(document.getRecord("ex:a1").length).toBe(1);
    expect(document.getRecords(ProvGeneration).length).toBe(1);
    expect(document.getRecords(ProvUsage).length).toBe(1);
    expect(closureAdded).toEqual([]);

    const json = document.serialize("json");
    const provn = document.serialize("provn");
    expect(json.length).toBeGreaterThan(0);
    expect(provn).toContain("wasGeneratedBy");
    expect(provn).toContain("used");
    // The PROV-JSON round-trip equals the document.
    expect(ProvDocument.deserialize(json, "json").equals(document)).toBe(true);
  });

  // Scenario: Inferred endpoints stay unasserted.
  test("an inferred endpoint's relation is emitted while its element is not (dangling reference)", () => {
    const doc = exDoc();
    doc.entity("ex:e2");
    doc.wasDerivedFrom("ex:e2", "ex:ghost"); // ex:ghost never declared → inferred node

    const g = provToGraph(doc);
    const result = lineage(g, "ex:e2");
    const { document, closureAdded } = toProvDocument(g, result);

    // The relation is present, still referencing the undeclared entity…
    const [derivation] = document.getRecords(ProvDerivation);
    expect(derivation).toBeDefined();
    expect(String(derivation?.args[1])).toBe("ex:ghost");
    // …while no element was fabricated for it: dangling is legal PROV, and the
    // closure cannot pull what the source document never declared.
    expect(document.getRecord("ex:ghost")).toEqual([]);
    expect(document.getRecords(ProvEntity).length).toBe(1); // e2 only
    expect(closureAdded).toEqual([]);
  });
});

describe("toProvDocument — reference closure (spec: referenced declarations pulled to a fixpoint, reported separately)", () => {
  /**
   * The n-ary fixture: only the derivation is walked; its activity/generation/
   * usage legs (a1, g1, u1) are declared but untraversed, and u1 references a
   * further entity e0 that only a second-level chase can reach.
   */
  function naryDoc(): ProvDocument {
    const doc = exDoc();
    doc.entity("ex:e0");
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e2", "ex:a1", undefined, "ex:g1");
    doc.used("ex:a1", "ex:e0", undefined, "ex:u1");
    doc.wasDerivedFrom("ex:e2", "ex:e1", "ex:a1", "ex:g1", "ex:u1");
    return doc;
  }

  // Scenario: An activity-aware derivation pulls its n-ary legs.
  test("the derivation's a1/g1/u1 legs and the elements THEY reference are pulled and listed", () => {
    const doc = naryDoc();
    const g = provToGraph(doc);
    // Restricting the walk to derivations is what leaves the legs untraversed.
    const result = lineage(g, "ex:e2", { relations: [ProvDerivation] });
    expect(result.edges.length).toBe(1); // only the derivation was walked

    const { document, closureAdded } = toProvDocument(g, result);

    // Pull order follows the derivation's formal-attribute order (activity,
    // generation, usage), then u1's second-level reference to e0.
    expect(closureAdded.map((r) => String(r.identifier))).toEqual([
      "ex:a1",
      "ex:g1",
      "ex:u1",
      "ex:e0",
    ]);
    // The pulled records are the output document's own (re-created) records.
    const outputRecords = document.getRecords();
    for (const pulled of closureAdded) {
      expect(outputRecords.includes(pulled)).toBe(true);
    }
    expect(document.getRecord("ex:a1").length).toBe(1);
    expect(document.getRecords(ProvGeneration).length).toBe(1);
    expect(document.getRecords(ProvUsage).length).toBe(1);
    expect(document.getRecord("ex:e0").length).toBe(1);

    // The closured document round-trips through PROV-JSON unchanged — the pulled
    // n-ary legs survive serialize/deserialize as faithfully as the walked slice.
    const json = document.serialize("json");
    expect(ProvDocument.deserialize(json, "json").equals(document)).toBe(true);

    // closure: "none" — the exact slice; every leg dangles and nothing is listed.
    const { document: bare, closureAdded: none } = toProvDocument(g, result, {
      closure: "none",
    });
    expect(none).toEqual([]);
    expect(bare.getRecords().length).toBe(3); // e2, e1, the derivation
    expect(bare.getRecord("ex:a1")).toEqual([]);
    expect(bare.getRecord("ex:g1")).toEqual([]);
    expect(bare.getRecord("ex:u1")).toEqual([]);
    expect(bare.getRecord("ex:e0")).toEqual([]);
  });

  // Scenario: Closure never bypasses the depth bound.
  test("a depth-bounded result does not pull the beyond-frontier chain", () => {
    const doc = derivChainDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e0", { depth: 1 }); // stops at e1; e2 is beyond

    const { document, closureAdded } = toProvDocument(g, result);

    // The walked derivation references only e0 and e1 — both already present —
    // so the closure adds nothing; e1's own onward derivation is adjacency,
    // which the closure never chases.
    expect(closureAdded).toEqual([]);
    expect(document.getRecord("ex:e2")).toEqual([]);
    expect(document.getRecords(ProvDerivation).length).toBe(1);
  });
});

describe("toProvDocument — frontier annotation (spec: opt-in, namespaced, absent by default)", () => {
  // Scenario: Truncation is visible in the serialized document on request.
  test("annotateFrontier marks the frontier element with tsprovq:truncated and declares the namespace", () => {
    const doc = derivChainDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e0", { depth: 1 }); // frontier: e1, reason "depth"

    const { document } = toProvDocument(g, result, { annotateFrontier: true });

    // The RE-CREATED e1 carries the mark; the non-frontier root e0 does not.
    expect(truncatedValues(document.getRecord("ex:e1")[0])).toEqual(["depth"]);
    expect(truncatedValues(document.getRecord("ex:e0")[0])).toEqual([]);
    // The graph's own record was never touched.
    expect(truncatedValues(g.document.getRecord("ex:e1")[0])).toEqual([]);

    // The vocabulary is visible in the serialized form: the namespace
    // declaration AND the attribute.
    const json = document.serialize("json");
    expect(json).toContain('"tsprovq":"https://tsprov.dev/ns/query#"');
    expect(json).toContain('"tsprovq:truncated":"depth"');
  });

  // Scenario: The default document is vocabulary-clean.
  test("without the option the serialized output carries no tsprovq vocabulary or declaration", () => {
    const doc = derivChainDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e0", { depth: 1 }); // same truncated result

    const { document } = toProvDocument(g, result);

    const json = document.serialize("json");
    expect(json).not.toContain("tsprovq");
    expect(json).not.toContain("tsprov.dev");
    expect(
      document.getRegisteredNamespaces().some((n) => n.prefix === "tsprovq"),
    ).toBe(false);
    expect(truncatedValues(document.getRecord("ex:e1")[0])).toEqual([]);
  });
});

describe("toFlatGraph (spec: JSON-safe, direction-independent projection)", () => {
  // Scenario: Backward and forward walks project identical edge orientations.
  test("backward and forward walks over the same chain project the same asserted edges", () => {
    const doc = chainDoc();
    const g = provToGraph(doc);

    const backward = toFlatGraph(lineage(g, "ex:e2"));
    const forward = toFlatGraph(lineage(g, "ex:e1", { direction: "forward" }));

    const edgeKey = (e: { from: string; to: string; relation: string }): string =>
      `${e.from} ${e.to} ${e.relation}`;
    expect(backward.edges.map(edgeKey).sort()).toEqual(
      forward.edges.map(edgeKey).sort(),
    );
    // Only the roots differ (both walks reach the whole chain here).
    expect(backward.roots).toEqual([uriOf(doc, "ex:e2")]);
    expect(forward.roots).toEqual([uriOf(doc, "ex:e1")]);

    // Relation labels are the PROV type in prefix:localpart form; kinds are
    // instanceof-discriminated.
    expect(new Set(backward.edges.map((e) => String(e.relation)))).toEqual(
      new Set(["prov:Generation", "prov:Usage"]),
    );
    const kinds = new Map(backward.nodes.map((n) => [n.uri, n.kind]));
    expect(kinds.get(uriOf(doc, "ex:a1"))).toBe("activity");
    expect(kinds.get(uriOf(doc, "ex:e1"))).toBe("entity");

    // Plain data: stringify → parse reproduces the projection exactly.
    expect(JSON.parse(JSON.stringify(backward))).toEqual(backward);
  });

  // Scenario: Truncation and terminals are distinguishable in the projection.
  test("a frontier node carries truncated while an exhausted terminal has no such key", () => {
    const doc = exDoc();
    doc.entity("ex:r");
    doc.entity("ex:t");
    doc.entity("ex:x");
    doc.entity("ex:y");
    doc.wasDerivedFrom("ex:r", "ex:t"); // t: terminal (no onward edges)
    doc.wasDerivedFrom("ex:r", "ex:x"); // x: cut at depth 1…
    doc.wasDerivedFrom("ex:x", "ex:y"); // …with y beyond the bound

    const g = provToGraph(doc);
    const flat = toFlatGraph(lineage(g, "ex:r", { depth: 1 }));

    const byUri = new Map(flat.nodes.map((n) => [n.uri, n]));
    const cut = byUri.get(uriOf(doc, "ex:x"));
    const terminal = byUri.get(uriOf(doc, "ex:t"));
    expect(cut?.truncated).toBe("depth");
    expect(terminal).toBeDefined();
    // The key is genuinely absent — not present-but-undefined — on a terminal.
    expect(terminal !== undefined && "truncated" in terminal).toBe(false);
    expect(byUri.has(uriOf(doc, "ex:y"))).toBe(false); // beyond the bound
  });
});

describe("lineagePaths (spec: result-scoped, oriented, explicitly bounded)", () => {
  // Scenario: A diamond yields both explanations.
  test("a backward diamond yields two asserted paths from e4 to e1 and is not truncated", () => {
    const doc = diamondDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e4");

    // `from` defaults to the result's roots (e4).
    const { paths, truncated } = lineagePaths(g, result, "ex:e1");

    expect(truncated).toBe(false);
    expect(paths.length).toBe(2);
    expect(paths.every((p) => p.orientation === "asserted")).toBe(true);

    const e1 = uriOf(doc, "ex:e1");
    const e2 = uriOf(doc, "ex:e2");
    const e3 = uriOf(doc, "ex:e3");
    const e4 = uriOf(doc, "ex:e4");
    expect(new Set(paths.map((p) => p.nodes.join(" ")))).toEqual(
      new Set([[e4, e2, e1].join(" "), [e4, e3, e1].join(" ")]),
    );
    // Each path's edges are the result's own GraphEdge objects, one per hop.
    const resultEdges = new Set(result.edges);
    for (const path of paths) {
      expect(path.edges.length).toBe(path.nodes.length - 1);
      for (const edge of path.edges) {
        expect(resultEdges.has(edge)).toBe(true);
      }
    }
  });

  // Scenario: A forward result explains via the reversed orientation.
  test("a forward walk's connection comes back as a reversed-orientation path", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.entity("ex:e3");
    doc.wasDerivedFrom("ex:e2", "ex:e1"); // asserted: e2 -> e1
    doc.wasDerivedFrom("ex:e3", "ex:e2"); // asserted: e3 -> e2

    const g = provToGraph(doc);
    const result = lineage(g, "ex:e1", { direction: "forward" }); // reaches e2, e3

    const { paths, truncated } = lineagePaths(g, result, "ex:e3", {
      from: "ex:e1",
    });

    expect(truncated).toBe(false);
    expect(paths.length).toBe(1);
    expect(paths[0]?.orientation).toBe("reversed");
    // The reversed path runs target → from in ASSERTED direction: e3 → e2 → e1.
    expect(paths[0]?.nodes).toEqual([
      uriOf(doc, "ex:e3"),
      uriOf(doc, "ex:e2"),
      uriOf(doc, "ex:e1"),
    ]);
  });

  // Scenario: The cap is explicit.
  test("limit: 1 over a diamond returns exactly one path with truncated: true", () => {
    const doc = diamondDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e4");

    const { paths, truncated } = lineagePaths(g, result, "ex:e1", { limit: 1 });

    expect(paths.length).toBe(1);
    expect(truncated).toBe(true);
  });

  // Scenario: A path far deeper than the JS call stack does not overflow.
  // The enumeration is an EXPLICIT-stack DFS precisely so a linear chain past the
  // call-stack limit (a recursive walk would `RangeError`) still enumerates.
  test("a 30k-hop linear chain enumerates its single path without a stack overflow", () => {
    // One straight derivation chain e0 -> e1 -> ... -> eN, N hops deep — well
    // beyond the ~10-15k-frame default JS call stack. No diamonds: exactly one
    // simple path exists, so the whole test stays O(N) and fast.
    const n = 30_000;
    const doc = exDoc();
    doc.entity("ex:e0");
    for (let i = 0; i < n; i += 1) {
      doc.entity(`ex:e${i + 1}`);
      doc.wasDerivedFrom(`ex:e${i}`, `ex:e${i + 1}`); // edge e_i -> e_{i+1}
    }

    const g = provToGraph(doc);
    // Explicit depth past the chain length so the walk reaches the far terminal;
    // the default MAX_WALK_DEPTH ceiling (1000) would otherwise truncate it.
    const result = lineage(g, "ex:e0", { depth: n });
    expect(result.frontier.length).toBe(0); // fully traversed, nothing cut

    const { paths, truncated } = lineagePaths(g, result, `ex:e${n}`);

    expect(truncated).toBe(false);
    expect(paths.length).toBe(1);
    expect(paths[0]?.orientation).toBe("asserted");
    expect(paths[0]?.nodes.length).toBe(n + 1); // e0 … eN inclusive
    expect(paths[0]?.nodes[0]).toBe(uriOf(doc, "ex:e0"));
    expect(paths[0]?.nodes[n]).toBe(uriOf(doc, `ex:e${n}`));
  });

  // Scenario: A NaN cap is a programmer error, not "unlimited".
  test("a NaN limit throws TypeError instead of silently disabling the cap", () => {
    const doc = diamondDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e4");

    expect(() => lineagePaths(g, result, "ex:e1", { limit: NaN })).toThrow(
      TypeError,
    );
  });
});

describe("views — non-mutation of every input (task 2.2)", () => {
  test("all three views leave the graph, its document, and the result untouched", () => {
    // A fixture that makes every code path do real work: a truncation frontier
    // (a1), a closure pull (u1 — referenced by the derivation, not walked at
    // depth 1), and a path search over the result.
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e2", "ex:a1", undefined, "ex:g1");
    doc.used("ex:a1", "ex:e1", undefined, "ex:u1");
    doc.wasDerivedFrom("ex:e2", "ex:e1", "ex:a1", "ex:g1", "ex:u1");

    const g = provToGraph(doc);
    const result = lineage(g, "ex:e2", { depth: 1 });
    expect(result.frontier.length).toBeGreaterThan(0); // the fixture truncates

    const recordKeysBefore = g.document.getRecords().map((r) => r.key).sort();
    const serializedBefore = g.document.serialize("json");
    const nodeCountBefore = g.nodes.length;
    const edgeCountBefore = g.edges.length;
    const resultNodesBefore = [...result.nodes];
    const resultEdgesBefore = [...result.edges];
    const resultFrontierBefore = result.frontier.map((f) => ({ ...f }));
    const resultRootsBefore = [...result.roots];
    const resultUnknownBefore = [...result.unknownRoots];

    toProvDocument(g, result);
    toProvDocument(g, result, { closure: "none" });
    toProvDocument(g, result, { annotateFrontier: true });
    toFlatGraph(result);
    lineagePaths(g, result, "ex:e1");

    // The graph's document: same records (by canonical key) AND the same
    // serialized form — an annotation or namespace leak onto the graph's
    // document would surface in either.
    expect(g.document.getRecords().map((r) => r.key).sort()).toEqual(
      recordKeysBefore,
    );
    expect(g.document.serialize("json")).toBe(serializedBefore);
    expect(g.nodes.length).toBe(nodeCountBefore);
    expect(g.edges.length).toBe(edgeCountBefore);

    // The result: same objects in the same order, frontier/roots verbatim.
    expect(result.nodes.length).toBe(resultNodesBefore.length);
    expect(result.nodes.every((n, i) => n === resultNodesBefore[i])).toBe(true);
    expect(result.edges.length).toBe(resultEdgesBefore.length);
    expect(result.edges.every((e, i) => e === resultEdgesBefore[i])).toBe(true);
    expect(result.frontier).toEqual(resultFrontierBefore);
    expect(result.roots).toEqual(resultRootsBefore);
    expect(result.unknownRoots).toEqual(resultUnknownBefore);
  });
});
