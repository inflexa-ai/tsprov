import { test, expect, describe } from "bun:test";

import { ProvDocument } from "../document.js";
import { QualifiedName } from "../identifier.js";
import {
  ProvGeneration,
  ProvUsage,
  ProvAssociation,
} from "../record/relation.js";
import { PROV_REVISION } from "../constants.js";
import type { GraphEdge } from "./graph.js";
import { provToGraph } from "./graph.js";
import { lineage, MAX_WALK_DEPTH, type LineageResult } from "./lineage.js";

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

/** The set of visited node URIs — the usual assertion target. */
function nodeUris(result: LineageResult): Set<string> {
  return new Set(result.nodes.map((n) => n.uri));
}

/** A frontier predicate: does the frontier hold this exact `(uri, direction, reason)` entry? */
function hasFrontier(
  result: LineageResult,
  uri: string,
  direction: "backward" | "forward",
  reason: "depth" | "ceiling",
): boolean {
  return result.frontier.some(
    (f) => f.uri === uri && f.direction === direction && f.reason === reason,
  );
}

describe("lineage — root normalization (spec: roots normalize, unknowns surfaced)", () => {
  // Scenario: A relation root seeds both endpoints.
  test("a relation root seeds both endpoints and roots contains both URIs", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    const gen = doc.wasGeneratedBy("ex:e1", "ex:a1");

    const g = provToGraph(doc);
    const result = lineage(g, gen);

    const e1 = uriOf(doc, "ex:e1");
    const a1 = uriOf(doc, "ex:a1");
    expect(new Set(result.roots)).toEqual(new Set([e1, a1]));
    // The walk starts from both endpoints, so both are visited.
    expect(nodeUris(result)).toEqual(new Set([e1, a1]));
  });

  // Scenario: An unknown root does not destroy a multi-root query.
  test("an unknown root lands in unknownRoots while the rest of the query proceeds", () => {
    const doc = exDoc();
    doc.entity("ex:e1"); // the only node; ex:nope is never declared

    const g = provToGraph(doc);
    const result = lineage(g, ["ex:e1", "ex:nope"]);

    expect(result.roots).toEqual([uriOf(doc, "ex:e1")]);
    // "ex:nope" resolves (ex: is registered) to a URI that is not a node.
    expect(result.unknownRoots).toEqual([uriOf(doc, "ex:nope")]);
    expect(nodeUris(result)).toEqual(new Set([uriOf(doc, "ex:e1")]));
  });

  // Companion to the above: a string that cannot even resolve to a QName surfaces
  // its RAW form (there is no URI to key a node by) — the documented unknownRoots
  // contract for an unresolvable prefixed string.
  test("an unresolvable-prefix string surfaces its raw form in unknownRoots", () => {
    const doc = exDoc();
    doc.entity("ex:e1");

    const g = provToGraph(doc);
    const result = lineage(g, ["ex:e1", "nope:whatever"]);

    expect(result.roots).toEqual([uriOf(doc, "ex:e1")]);
    expect(result.unknownRoots).toEqual(["nope:whatever"]);
  });
});

describe("lineage — direction (spec: effect→cause orientation, alternateOf symmetric)", () => {
  /** e2 --gen--> a1 --used--> e1 : a two-hop backward chain. */
  function chainDoc(): ProvDocument {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e2", "ex:a1"); // e2 -> a1
    doc.used("ex:a1", "ex:e1"); // a1 -> e1
    return doc;
  }

  // Scenario: Backward ancestry crosses an entity-activity chain.
  test("backward ancestry crosses the entity-activity chain", () => {
    const doc = chainDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e2"); // default: backward

    expect(nodeUris(result)).toEqual(
      new Set([uriOf(doc, "ex:e2"), uriOf(doc, "ex:a1"), uriOf(doc, "ex:e1")]),
    );
    expect(result.edges.length).toBe(2);
    expect(
      result.edges.some((e) => e.relation instanceof ProvGeneration),
    ).toBe(true);
    expect(result.edges.some((e) => e.relation instanceof ProvUsage)).toBe(true);
  });

  // Scenario: Forward descendants is the reverse walk.
  test("forward descendants walks the same edges in reverse", () => {
    const doc = chainDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e1", { direction: "forward" });

    expect(nodeUris(result)).toEqual(
      new Set([uriOf(doc, "ex:e1"), uriOf(doc, "ex:a1"), uriOf(doc, "ex:e2")]),
    );
    expect(result.edges.length).toBe(2);
  });

  // Scenario: Both is ancestors plus descendants, not the undirected component.
  test("both is ancestors ∪ descendants, excluding a shared-input sibling branch", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.entity("ex:e3");
    doc.activity("ex:a1");
    doc.activity("ex:a2");
    doc.used("ex:a1", "ex:e1"); // a1 -> e1
    doc.used("ex:a2", "ex:e1"); // a2 -> e1 (shared input)
    doc.wasGeneratedBy("ex:e2", "ex:a1"); // e2 -> a1
    doc.wasGeneratedBy("ex:e3", "ex:a2"); // e3 -> a2 (sibling output)

    const g = provToGraph(doc);
    const result = lineage(g, "ex:e2", { direction: "both" });

    // e2's ancestors (a1, e1); e2 has no descendants; a2/e3 are reachable only by
    // flipping direction at the shared input e1 — the undirected walk we exclude.
    expect(nodeUris(result)).toEqual(
      new Set([uriOf(doc, "ex:e2"), uriOf(doc, "ex:a1"), uriOf(doc, "ex:e1")]),
    );
    expect(nodeUris(result).has(uriOf(doc, "ex:a2"))).toBe(false);
    expect(nodeUris(result).has(uriOf(doc, "ex:e3"))).toBe(false);
  });

  // Scenario: alternateOf reaches both ways regardless of direction.
  test("alternateOf is traversed against its orientation (structure profile)", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.alternateOf("ex:e1", "ex:e2"); // edge e1 -> e2 (alternate1 -> alternate2)

    const g = provToGraph(doc);
    // Backward from e2 would normally follow e2's out-edges (none); the symmetric
    // alternate rule crosses the e1->e2 edge to reach e1. Requires a profile that
    // includes Alternate — it is a "structure" edge, not a "dataflow" one.
    const result = lineage(g, "ex:e2", {
      direction: "backward",
      relations: "structure",
    });

    expect(nodeUris(result).has(uriOf(doc, "ex:e1"))).toBe(true);
  });
});

describe("lineage — relation profiles (spec: profiles scope, edgeWhere composes)", () => {
  /** e2 --gen--> a1 --wasAssociatedWith--> ag1. */
  function responsibilityDoc(): ProvDocument {
    const doc = exDoc();
    doc.entity("ex:e2");
    doc.activity("ex:a1");
    doc.agent("ex:ag1");
    doc.wasGeneratedBy("ex:e2", "ex:a1"); // e2 -> a1 (dataflow)
    doc.wasAssociatedWith("ex:a1", "ex:ag1"); // a1 -> ag1 (responsibility)
    return doc;
  }

  // Scenario: The default dataflow walk ignores responsibility edges.
  test("default dataflow reaches the activity but not the agent", () => {
    const doc = responsibilityDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e2"); // default: backward + dataflow

    expect(nodeUris(result)).toEqual(
      new Set([uriOf(doc, "ex:e2"), uriOf(doc, "ex:a1")]),
    );
    expect(nodeUris(result).has(uriOf(doc, "ex:ag1"))).toBe(false);
    // The association edge was not traversed.
    expect(
      result.edges.some((e) => e.relation instanceof ProvAssociation),
    ).toBe(false);
  });

  // Scenario: A profile switch reaches the agent.
  test("relations: all reaches the agent through the association edge", () => {
    const doc = responsibilityDoc();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e2", { relations: "all" });

    expect(nodeUris(result).has(uriOf(doc, "ex:ag1"))).toBe(true);
    expect(
      result.edges.some((e) => e.relation instanceof ProvAssociation),
    ).toBe(true);
  });

  // Scenario: Influence traverses only under all.
  test("wasInfluencedBy is unreached under dataflow and reached under all", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.wasInfluencedBy("ex:e2", "ex:e1"); // e2 -> e1 (Influence)

    const g = provToGraph(doc);

    const underDataflow = lineage(g, "ex:e2");
    expect(nodeUris(underDataflow).has(uriOf(doc, "ex:e1"))).toBe(false);

    const underAll = lineage(g, "ex:e2", { relations: "all" });
    expect(nodeUris(underAll).has(uriOf(doc, "ex:e1"))).toBe(true);
  });

  // Scenario: edgeWhere refines derivations to revisions.
  test("edgeWhere restricts derivations to prov:Revision-typed ones", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.entity("ex:e3");
    doc.wasDerivedFrom("ex:e3", "ex:e2"); // e3 -> e2 (plain derivation)
    doc.wasRevisionOf("ex:e2", "ex:e1"); // e2 -> e1 (Revision-typed derivation)

    const g = provToGraph(doc);
    // Compare by URI rather than reference: robust even if interning did not
    // preserve the exact PROV_REVISION object across flatten/unified (it does —
    // asserted prov:type re-resolves to the interned QName — but URI is total).
    const revisionOnly = (edge: GraphEdge): boolean =>
      edge.relation
        .getAssertedTypes()
        .some((t) => t instanceof QualifiedName && t.uri === PROV_REVISION.uri);

    const fromE3 = lineage(g, "ex:e3", { edgeWhere: revisionOnly });
    // The plain derivation off e3 is filtered — nothing is traversed.
    expect(nodeUris(fromE3)).toEqual(new Set([uriOf(doc, "ex:e3")]));
    expect(fromE3.edges.length).toBe(0);

    const fromE2 = lineage(g, "ex:e2", { edgeWhere: revisionOnly });
    // The revision off e2 passes the predicate — e1 is reached.
    expect(nodeUris(fromE2)).toEqual(
      new Set([uriOf(doc, "ex:e2"), uriOf(doc, "ex:e1")]),
    );
    expect(fromE2.edges.length).toBe(1);
  });
});

describe("lineage — depth bounds (spec: per-direction hops, explicit frontier)", () => {
  /** A backward derivation chain e0 -> e1 -> e2 -> e3 (three hops). */
  function derivChain(): ProvDocument {
    const doc = exDoc();
    doc.entity("ex:e0");
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.entity("ex:e3");
    doc.wasDerivedFrom("ex:e0", "ex:e1"); // e0 -> e1
    doc.wasDerivedFrom("ex:e1", "ex:e2"); // e1 -> e2
    doc.wasDerivedFrom("ex:e2", "ex:e3"); // e2 -> e3
    return doc;
  }

  // Scenario: A depth-1 walk marks the frontier.
  test("depth: 1 stops after one hop and marks the reached node as frontier", () => {
    const doc = derivChain();
    const g = provToGraph(doc);
    const result = lineage(g, "ex:e0", { depth: 1 });

    expect(nodeUris(result)).toEqual(
      new Set([uriOf(doc, "ex:e0"), uriOf(doc, "ex:e1")]),
    );
    expect(hasFrontier(result, uriOf(doc, "ex:e1"), "backward", "depth")).toBe(true);
    // The chain's true terminal is beyond the bound.
    expect(nodeUris(result).has(uriOf(doc, "ex:e3"))).toBe(false);
  });

  // Scenario: Asymmetric bounds apply per direction.
  test("both with { back: 2, forward: 1 } bounds each side independently", () => {
    const doc = exDoc();
    doc.entity("ex:r");
    doc.entity("ex:b1");
    doc.entity("ex:b2");
    doc.entity("ex:b3");
    doc.entity("ex:f1");
    doc.entity("ex:f2");
    doc.wasDerivedFrom("ex:r", "ex:b1"); // backward: r -> b1
    doc.wasDerivedFrom("ex:b1", "ex:b2"); // b1 -> b2
    doc.wasDerivedFrom("ex:b2", "ex:b3"); // b2 -> b3
    doc.wasDerivedFrom("ex:f1", "ex:r"); // forward: f1 -> r (r's in-edge)
    doc.wasDerivedFrom("ex:f2", "ex:f1"); // f2 -> f1

    const g = provToGraph(doc);
    const result = lineage(g, "ex:r", {
      direction: "both",
      depth: { back: 2, forward: 1 },
    });

    // Backward reaches two hops (b1, b2) and stops; forward reaches one (f1).
    expect(nodeUris(result)).toEqual(
      new Set([
        uriOf(doc, "ex:r"),
        uriOf(doc, "ex:b1"),
        uriOf(doc, "ex:b2"),
        uriOf(doc, "ex:f1"),
      ]),
    );
    expect(nodeUris(result).has(uriOf(doc, "ex:b3"))).toBe(false);
    expect(nodeUris(result).has(uriOf(doc, "ex:f2"))).toBe(false);
    // Each side's cutoff carries its own direction-tagged frontier entry.
    expect(hasFrontier(result, uriOf(doc, "ex:b2"), "backward", "depth")).toBe(true);
    expect(hasFrontier(result, uriOf(doc, "ex:f1"), "forward", "depth")).toBe(true);
  });

  // Scenario: A terminal node is not frontier.
  test("an exhausted terminal is in nodes but not in frontier", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e2", "ex:a1"); // e2 -> a1
    doc.used("ex:a1", "ex:e1"); // a1 -> e1 (e1 has no generation → terminal)

    const g = provToGraph(doc);
    const result = lineage(g, "ex:e2"); // unbounded backward

    expect(nodeUris(result).has(uriOf(doc, "ex:e1"))).toBe(true);
    expect(result.frontier.length).toBe(0);
  });

  // Scenario: A cycle terminates without markers or hangs.
  test("a self-read cycle terminates with each node and edge once and no frontier", () => {
    const doc = exDoc();
    doc.entity("ex:e");
    doc.activity("ex:a");
    doc.wasGeneratedBy("ex:e", "ex:a"); // e -> a
    doc.used("ex:a", "ex:e"); // a -> e (the cycle)

    const g = provToGraph(doc);
    const result = lineage(g, "ex:e"); // unbounded backward

    expect(nodeUris(result)).toEqual(
      new Set([uriOf(doc, "ex:e"), uriOf(doc, "ex:a")]),
    );
    expect(result.nodes.length).toBe(2);
    expect(result.edges.length).toBe(2);
    expect(result.frontier.length).toBe(0);
  });
});

describe("lineage — unbounded ceiling (spec: MAX_WALK_DEPTH truncates as reason 'ceiling', D4)", () => {
  /**
   * A simple backward gen/used chain longer than MAX_WALK_DEPTH hops: entities
   * `e0..eM` and activities `a0..a{M-1}` linked so that `e_{i+1} --gen--> a_i`
   * and `a_i --used--> e_i`. An unbounded backward walk from `eM` therefore
   * crosses `2*M` edges as a single path, discovering each node at a unique hop
   * (`e_{M-k}` at hop `2k`, `a_{M-1-k}` at hop `2k+1`). Building ~1k records is
   * milliseconds in bun, so the fixture stays cheap despite its length.
   */
  function longBackwardChain(m: number): ProvDocument {
    const doc = exDoc();
    doc.entity("ex:e0");
    for (let i = 0; i < m; i += 1) {
      doc.entity(`ex:e${i + 1}`);
      doc.activity(`ex:a${i}`);
      doc.wasGeneratedBy(`ex:e${i + 1}`, `ex:a${i}`); // e_{i+1} -> a_i
      doc.used(`ex:a${i}`, `ex:e${i}`); // a_i -> e_i
    }
    return doc;
  }

  // Scenario: An unbounded walk deeper than the safety ceiling truncates there.
  test("an unbounded walk past MAX_WALK_DEPTH stops at exactly one ceiling frontier and omits the far terminal", () => {
    // MAX_WALK_DEPTH is even (1000), so the ceiling hop lands on an entity
    // (`e_{M - MAX_WALK_DEPTH/2}`). Size the chain a few hops past the ceiling so
    // that node still has an untraversed onward edge and the terminal e0 sits
    // beyond it (2*m = MAX_WALK_DEPTH + 20 hops).
    const m = MAX_WALK_DEPTH / 2 + 10;
    const doc = longBackwardChain(m);
    const g = provToGraph(doc);

    const result = lineage(g, `ex:e${m}`); // unbounded backward from the chain end

    // Terminates (the test completing at all is the proof) with a single
    // truncation: the lone node at the ceiling hop still has an onward gen edge.
    expect(result.frontier.length).toBe(1);
    expect(result.frontier[0]?.reason).toBe("ceiling");
    expect(result.frontier[0]?.direction).toBe("backward");
    expect(result.frontier[0]?.uri).toBe(
      uriOf(doc, `ex:e${m - MAX_WALK_DEPTH / 2}`),
    );
    // The chain's far terminal is beyond the ceiling — never reached.
    expect(nodeUris(result).has(uriOf(doc, "ex:e0"))).toBe(false);
  });

  // Scenario: Infinity is a legal "no bound" — the ceiling is opt-out, not opt-in.
  test("depth: Infinity walks a chain past the ceiling to exhaustion with an empty frontier", () => {
    // Explicit unbounded intent (Infinity is NOT NaN — the visited set still
    // terminates the walk). A chain longer than MAX_WALK_DEPTH is fully traversed
    // and, because no node ever reaches a finite bound, nothing is truncated.
    const m = MAX_WALK_DEPTH / 2 + 10; // 2*m = MAX_WALK_DEPTH + 20 hops
    const doc = longBackwardChain(m);
    const g = provToGraph(doc);

    const result = lineage(g, `ex:e${m}`, { depth: Infinity });

    expect(result.frontier.length).toBe(0);
    // The far terminal that the ceiling run stopped short of IS reached here.
    expect(nodeUris(result).has(uriOf(doc, "ex:e0"))).toBe(true);
  });
});

describe("lineage — NaN depth is a programmer error (spec: reject, don't reinterpret, F2)", () => {
  /** A single-node graph — enough to reach `boundFor`, which throws before the walk. */
  function oneNodeGraph(): ReturnType<typeof provToGraph> {
    const doc = exDoc();
    doc.entity("ex:e1");
    return provToGraph(doc);
  }

  // Scenario: A bare NaN depth would make `current.depth >= NaN` always false,
  // silently defeating the ceiling — reject it instead.
  test("a bare NaN depth throws TypeError", () => {
    const g = oneNodeGraph();
    expect(() => lineage(g, "ex:e1", { depth: NaN })).toThrow(TypeError);
  });

  // Scenario: The object form is checked on the direction that actually runs
  // (default backward reads `back`).
  test("a NaN in { back } throws TypeError", () => {
    const g = oneNodeGraph();
    expect(() => lineage(g, "ex:e1", { depth: { back: NaN } })).toThrow(TypeError);
  });
});

describe("lineage — flat, deduplicated, reference-based result (spec: D6)", () => {
  // Scenario: A diamond dedups.
  test("a diamond visits the shared ancestor once and every edge once", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.entity("ex:e3");
    doc.entity("ex:e4");
    doc.activity("ex:a3");
    doc.wasGeneratedBy("ex:e4", "ex:a3"); // e4 -> a3
    doc.used("ex:a3", "ex:e2"); // a3 -> e2
    doc.used("ex:a3", "ex:e3"); // a3 -> e3
    doc.wasDerivedFrom("ex:e2", "ex:e1"); // e2 -> e1
    doc.wasDerivedFrom("ex:e3", "ex:e1"); // e3 -> e1 (second path to e1)

    const g = provToGraph(doc);
    const result = lineage(g, "ex:e4");

    const e1 = uriOf(doc, "ex:e1");
    expect(result.nodes.filter((n) => n.uri === e1).length).toBe(1);
    expect(result.nodes.length).toBe(5);
    expect(result.edges.length).toBe(5);
    // Every edge appears exactly once (no duplicate references).
    expect(new Set(result.edges).size).toBe(result.edges.length);
  });

  // Scenario: Both-union edges are not double-counted.
  test("an edge reachable from a root in each direction appears once under both", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e1", "ex:a1"); // the single edge e1 -> a1

    const g = provToGraph(doc);
    // With both roots, the backward run traverses the edge out of e1 and the
    // forward run traverses the same edge into a1 — reference dedup keeps it once.
    const result = lineage(g, ["ex:e1", "ex:a1"], { direction: "both" });

    expect(result.edges.length).toBe(1);
  });

  // Task 2.2: the result carries the graph's own objects and mutates nothing.
  test("result nodes/edges are the graph's own objects and the walk mutates nothing", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e2", "ex:a1"); // e2 -> a1
    doc.used("ex:a1", "ex:e1"); // a1 -> e1

    const g = provToGraph(doc);

    const docKeysBefore = g.document.getRecords().map((r) => r.key).sort();
    const nodeCountBefore = g.nodes.length;
    const edgeCountBefore = g.edges.length;
    const graphEdges = new Set(g.edges);

    const result = lineage(g, "ex:e2", { direction: "both", relations: "all" });

    // Reference identity: each result node/edge IS the graph's own object.
    for (const node of result.nodes) {
      expect(g.getNode(node.uri)).toBe(node);
    }
    for (const edge of result.edges) {
      expect(graphEdges.has(edge)).toBe(true);
    }

    // Non-mutation: the graph's document and its node/edge sets are unchanged.
    expect(g.document.getRecords().map((r) => r.key).sort()).toEqual(docKeysBefore);
    expect(g.nodes.length).toBe(nodeCountBefore);
    expect(g.edges.length).toBe(edgeCountBefore);
  });
});
