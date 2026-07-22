import { test, expect, describe } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ProvDocument } from "../document.js";
import { ProvEntity, ProvActivity } from "../record/element.js";
import { ProvGeneration, ProvUsage } from "../record/relation.js";
import * as coreBarrel from "../index.js";
import { ProvGraph, provToGraph, graphToProv } from "./graph.js";

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

describe("ProvGraph — nodes, edges, payloads", () => {
  // Spec: "Elements become nodes and relations become payload-carrying edges".
  test("elements become nodes and a relation becomes a payload-carrying edge", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e1", "ex:a1");

    const g = provToGraph(doc);
    const e1 = uriOf(doc, "ex:e1");
    const a1 = uriOf(doc, "ex:a1");

    expect(g.hasNode(e1)).toBe(true);
    expect(g.hasNode(a1)).toBe(true);
    expect(g.getNode(e1)?.element).toBeInstanceOf(ProvEntity);
    expect(g.getNode(a1)?.element).toBeInstanceOf(ProvActivity);

    expect(g.edges.length).toBe(1);
    const [edge] = g.edges;
    expect(edge?.from).toBe(e1);
    expect(edge?.to).toBe(a1);
    // The edge carries the whole relation record, not a bare (from, to) pair.
    expect(edge?.relation).toBeInstanceOf(ProvGeneration);
    expect(g.skipped.length).toBe(0);
  });

  // Spec: "Parallel relations are distinct edges" — kept in document order.
  test("parallel relations become distinct edges in document order", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.used("ex:a1", "ex:e1", undefined, null, { "ex:role": "first" });
    doc.used("ex:a1", "ex:e1", undefined, null, { "ex:role": "second" });

    const g = provToGraph(doc);
    const a1 = uriOf(doc, "ex:a1");
    const e1 = uriOf(doc, "ex:e1");

    const out = g.outEdges(a1);
    expect(out.length).toBe(2);
    expect(out.every((edge) => edge.from === a1 && edge.to === e1)).toBe(true);
    expect(out.every((edge) => edge.relation instanceof ProvUsage)).toBe(true);
    // Document order is preserved: first-authored role comes first.
    expect(out[0]?.relation.getAttribute("ex:role").map(String)).toEqual(["first"]);
    expect(out[1]?.relation.getAttribute("ex:role").map(String)).toEqual(["second"]);
  });

  // Spec: "Reverse adjacency answers 'what points at X'".
  test("forward and reverse adjacency are both indexed", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.activity("ex:a2");
    doc.wasGeneratedBy("ex:e1", "ex:a1"); // e1 -> a1
    doc.used("ex:a2", "ex:e1"); // a2 -> e1

    const g = provToGraph(doc);
    const e1 = uriOf(doc, "ex:e1");
    const a1 = uriOf(doc, "ex:a1");
    const a2 = uriOf(doc, "ex:a2");

    const forward = g.outEdges(e1);
    expect(forward.length).toBe(1);
    expect(forward[0]?.to).toBe(a1);
    expect(forward[0]?.relation).toBeInstanceOf(ProvGeneration);

    const reverse = g.inEdges(e1);
    expect(reverse.length).toBe(1);
    expect(reverse[0]?.from).toBe(a2);
    expect(reverse[0]?.relation).toBeInstanceOf(ProvUsage);
  });

  test("nodes and edges are enumerable", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e1", "ex:a1");

    const g = provToGraph(doc);
    expect(g.nodes.map((n) => n.uri).sort()).toEqual(
      [uriOf(doc, "ex:e1"), uriOf(doc, "ex:a1")].sort(),
    );
    expect(g.edges.length).toBe(1);
    expect(g.getNode("http://example.org/missing")).toBeUndefined();
    expect(g.outEdges("http://example.org/missing")).toEqual([]);
    expect(g.inEdges("http://example.org/missing")).toEqual([]);
  });
});

describe("ProvGraph — bundle participation (divergence from Python)", () => {
  // Spec: "Records inside bundles participate".
  test("a relation living inside a bundle becomes an edge", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    const b = doc.bundle("ex:b1");
    b.wasGeneratedBy("ex:e1", "ex:a1"); // the ONLY relation, inside a bundle

    const g = provToGraph(doc);
    // Python's converter never sees inside bundles; ours does (flattened first).
    expect(g.edges.length).toBe(1);
    expect(g.edges[0]?.relation).toBeInstanceOf(ProvGeneration);
    // graph.document is the flattened + unified transform: no sub-bundles left.
    expect(g.document.hasBundles()).toBe(false);
    expect(
      g.document.getRecords(ProvGeneration).length,
    ).toBe(1);
  });
});

describe("ProvGraph — inferred endpoints", () => {
  // Spec: "A generation pointing at an undeclared activity infers an activity node".
  test("an undeclared activity endpoint becomes an inferred ProvActivity node", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.wasGeneratedBy("ex:e1", "ex:a1"); // a1 never declared

    const g = provToGraph(doc);
    const a1 = uriOf(doc, "ex:a1");
    const node = g.getNode(a1);
    expect(node?.inferred).toBe(true);
    expect(node?.element).toBeInstanceOf(ProvActivity);
    expect(g.edges.length).toBe(1);
    expect(g.edges[0]?.to).toBe(a1);
    // The document was NOT mutated: a1 has no declared record.
    expect(doc.getRecord("ex:a1")).toEqual([]);
  });

  test("an endpoint declared anywhere in the document is not inferred", () => {
    const doc = exDoc();
    // Relation authored BEFORE the activity is declared.
    doc.wasGeneratedBy("ex:e1", "ex:a1");
    doc.entity("ex:e1");
    doc.activity("ex:a1");

    const g = provToGraph(doc);
    expect(g.getNode(uriOf(doc, "ex:a1"))?.inferred).toBe(false);
    expect(g.getNode(uriOf(doc, "ex:e1"))?.inferred).toBe(false);
    expect(g.skipped.length).toBe(0);
  });

  // Spec: "A relation missing an endpoint is skipped observably".
  test("a relation missing an endpoint is skipped and recorded", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.wasGeneratedBy("ex:e1"); // no activity

    const g = provToGraph(doc);
    expect(g.edges.length).toBe(0);
    expect(g.hasNode(uriOf(doc, "ex:e1"))).toBe(true); // e1 still a node
    expect(g.skipped.length).toBe(1);
    expect(g.skipped[0]?.reason).toBe("missing-endpoint");
    expect(g.skipped[0]?.relation).toBeInstanceOf(ProvGeneration);
  });

  test("an influence with an undeclared endpoint is skipped as unmapped-attribute", () => {
    const doc = exDoc();
    // Neither endpoint declared; prov:influencee/influencer are (as in Python)
    // absent from the inferred-class map, so the relation cannot be typed.
    doc.wasInfluencedBy("ex:x", "ex:y");

    const g = provToGraph(doc);
    expect(g.edges.length).toBe(0);
    expect(g.skipped.length).toBe(1);
    expect(g.skipped[0]?.reason).toBe("unmapped-attribute");
  });

  test("an influence between two declared elements still becomes an edge", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.entity("ex:e2");
    doc.wasInfluencedBy("ex:e1", "ex:e2");

    const g = provToGraph(doc);
    expect(g.skipped.length).toBe(0);
    expect(g.edges.length).toBe(1);
    expect(g.edges[0]?.from).toBe(uriOf(doc, "ex:e1"));
    expect(g.edges[0]?.to).toBe(uriOf(doc, "ex:e2"));
  });
});

describe("ProvGraph — non-mutation of the input document", () => {
  test("building the graph does not mutate the caller's document", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.wasGeneratedBy("ex:e1", "ex:a1"); // a1 gets inferred during build

    const before = doc.getRecords().map((r) => r.key).sort();
    const g = provToGraph(doc);
    // The inference happened (proving the build did real work)...
    expect(g.getNode(uriOf(doc, "ex:a1"))?.inferred).toBe(true);
    // ...yet the original document is unchanged.
    const after = doc.getRecords().map((r) => r.key).sort();
    expect(after).toEqual(before);
    expect(doc.getRecord("ex:a1")).toEqual([]);
  });
});

describe("graphToProv — round-trip and inferred-node skipping", () => {
  test("round-trips a simple document back to its transform", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.activity("ex:a1");
    doc.wasGeneratedBy("ex:e1", "ex:a1");

    const back = graphToProv(provToGraph(doc));
    expect(back.equals(doc.flattened().unified())).toBe(true);
  });

  // Spec: "Inferred nodes do not come back".
  test("inferred nodes are not emitted, but the relation referencing them is", () => {
    const doc = exDoc();
    doc.entity("ex:e1");
    doc.wasGeneratedBy("ex:e1", "ex:a1"); // a1 inferred

    const back = graphToProv(provToGraph(doc));
    // The inferred activity is not declared...
    expect(back.getRecord("ex:a1")).toEqual([]);
    expect(back.getRecords(ProvActivity).length).toBe(0);
    // ...while the entity and the generation relation are present.
    expect(back.getRecords(ProvEntity).length).toBe(1);
    expect(back.getRecords(ProvGeneration).length).toBe(1);
  });
});

describe("graph layer isolation", () => {
  // Spec: "src/index.ts exports nothing graph-related".
  test("the core barrel exposes no graph symbols", () => {
    for (const symbol of ["ProvGraph", "provToGraph", "graphToProv"]) {
      expect(symbol in coreBarrel).toBe(false);
    }
  });
});

// ── Corpus round-trip oracle (design D7) ──────────────────────────────────────
// The 398-file Python corpus is the repo's oracle (there is no TS port of the
// Python `examples.py` that `test_graphs.py` uses). Reuses json.test.ts's loading
// pattern. For every file, `graphToProv(provToGraph(doc))` must equal
// `doc.flattened().unified()` when the conversion skipped nothing; when it skipped
// relations, the skip accounting must explain the difference exactly; and when
// `unified()` throws (a genuine same-id formal-attribute clash — parity with
// Python's model.py:1681), `provToGraph` must throw equivalently.
const CORPUS_DIR = join(
  import.meta.dir,
  // The corpus is checked out at the repo root, four levels above this file
  // (packages/tsprov/src/graph) — it is a shared, gitignored checkout, not
  // vendored into the package.
  "../../../../reference/prov/src/prov/tests/json",
);
const corpusFiles = readdirSync(CORPUS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

/** How a corpus file round-tripped — used to pin the partition counts. */
type Classification = "clean" | "skip-explained" | "unify-threw";

/** Set equality over canonical string keys. */
function sameKeys(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

describe("ProvGraph corpus round-trip oracle", () => {
  test("corpus is present (398 files)", () => {
    expect(corpusFiles.length).toBe(398);
  });

  const classifications: Classification[] = [];

  for (const file of corpusFiles) {
    test(file, () => {
      const doc = ProvDocument.deserialize(
        readFileSync(join(CORPUS_DIR, file), "utf8"),
        "json",
      );

      let transform: ProvDocument;
      try {
        transform = doc.flattened().unified();
      } catch {
        // Same-id formal-attribute clash: `unified("throw")` rejects it, and so
        // must `provToGraph` (which unifies internally). This is parity, not a bug.
        expect(() => provToGraph(doc)).toThrow();
        classifications.push("unify-threw");
        return;
      }

      const graph = provToGraph(doc);
      const back = graphToProv(graph);

      if (graph.skipped.length === 0) {
        expect(back.equals(transform)).toBe(true);
        classifications.push("clean");
        return;
      }

      // Lossy conversion: the result must be exactly the transform minus the
      // skipped relations. Recovering the transform's key set by adding the
      // skipped relations' keys back to the result proves nothing was lost that
      // the skip accounting does not explain (loop rule 6: no silent skips).
      const backKeys = new Set(back.getRecords().map((r) => r.key));
      const transformKeys = new Set(transform.getRecords().map((r) => r.key));
      const recovered = new Set(backKeys);
      for (const s of graph.skipped) recovered.add(s.relation.key);
      expect(sameKeys(recovered, transformKeys)).toBe(true);
      classifications.push("skip-explained");
    });
  }

  test("every corpus file falls in exactly one partition bucket", () => {
    const clean = classifications.filter((c) => c === "clean").length;
    const skipExplained = classifications.filter(
      (c) => c === "skip-explained",
    ).length;
    const unifyThrew = classifications.filter(
      (c) => c === "unify-threw",
    ).length;
    console.log(
      `ProvGraph corpus partition: clean=${clean} skip-explained=${skipExplained} unify-threw=${unifyThrew} (total=${classifications.length})`,
    );
    expect(classifications.length).toBe(corpusFiles.length);
    expect(clean).toBeGreaterThan(0);
  });
});
