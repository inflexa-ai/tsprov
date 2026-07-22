import { test, expect } from "bun:test";
import { ProvDocument, ns, PROV_LABEL } from "@inflexa-ai/tsprov";

import { toRenderScene } from "./scene.js";
import type { RenderNode, RenderEdge } from "./scene.js";

const ex = ns("ex", "http://example.org/");

/** A fresh document with the `ex` namespace registered, matching how the fixtures declare names. */
function newDoc(): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  return doc;
}

function nodeById(nodes: readonly RenderNode[], id: string): RenderNode {
  const node = nodes.find((n) => n.id === id);
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

function edgeByRelation(
  edges: readonly RenderEdge[],
  relation: string,
): RenderEdge {
  const edge = edges.find((e) => e.relation === relation);
  if (edge === undefined) throw new Error(`no ${relation} edge`);
  return edge;
}

test("primer triangle projects completely", () => {
  const doc = newDoc();
  const article = doc.entity(ex.qn("article"));
  const edit = doc.activity(ex.qn("edit"));
  const alice = doc.agent(ex.qn("alice"));
  article.wasGeneratedBy(edit);
  edit.wasAssociatedWith(alice);
  article.wasAttributedTo(alice);

  const scene = toRenderScene(doc);

  expect(scene.nodes.map((n) => [n.id, n.kind, n.qualifiedName])).toEqual([
    ["n1", "entity", "ex:article"],
    ["n2", "activity", "ex:edit"],
    ["n3", "agent", "ex:alice"],
  ]);
  expect(scene.nodes.every((n) => !n.inferred)).toBe(true);

  const gen = edgeByRelation(scene.edges, "prov:Generation");
  expect([gen.label, gen.source, gen.target]).toEqual([
    "wasGeneratedBy",
    "n1",
    "n2",
  ]);
  const assoc = edgeByRelation(scene.edges, "prov:Association");
  expect([assoc.label, assoc.source, assoc.target]).toEqual([
    "wasAssociatedWith",
    "n2",
    "n3",
  ]);
  const attr = edgeByRelation(scene.edges, "prov:Attribution");
  expect([attr.label, attr.source, attr.target]).toEqual([
    "wasAttributedTo",
    "n1",
    "n3",
  ]);
  expect(scene.edges.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  expect(scene.skipped).toEqual([]);
});

test("n-ary derivation keeps its legs and references its endpoints", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e2"));
  doc.entity(ex.qn("e1"));
  doc.activity(ex.qn("act"));
  // generatedEntity=e2, usedEntity=e1, activity=act (declared), generation=gPoint
  // (undeclared → inferred), usage omitted.
  doc.wasDerivedFrom(ex.qn("e2"), ex.qn("e1"), ex.qn("act"), ex.qn("gPoint"));

  const scene = toRenderScene(doc);
  const derivation = edgeByRelation(scene.edges, "prov:Derivation");
  expect([derivation.source, derivation.target]).toEqual(["n1", "n2"]); // e2, e1

  // Legs: activity (localpart "activity") → declared act node; generation
  // (localpart "generation") → an inferred node. Usage is unset, so no leg.
  expect(derivation.naryLegs.map((l) => l.role)).toEqual([
    "activity",
    "generation",
  ]);
  const activityLeg = derivation.naryLegs[0];
  const generationLeg = derivation.naryLegs[1];
  if (activityLeg === undefined || generationLeg === undefined) {
    throw new Error("expected two legs");
  }
  expect(nodeById(scene.nodes, activityLeg.target).qualifiedName).toBe("ex:act");
  expect(nodeById(scene.nodes, activityLeg.target).inferred).toBe(false);
  const generationEndpoint = nodeById(scene.nodes, generationLeg.target);
  expect(generationEndpoint.qualifiedName).toBe("ex:gPoint");
  expect(generationEndpoint.inferred).toBe(true);

  // showNary:false drops every leg but keeps source/target.
  const noNary = toRenderScene(doc, { showNary: false });
  expect(edgeByRelation(noNary.edges, "prov:Derivation").naryLegs).toEqual([]);
});

test("undeclared endpoints become inferred nodes with the domain kind", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"));
  // Generation to an undeclared activity → inferred activity node.
  e.wasGeneratedBy(ex.qn("ghostActivity"));

  const scene = toRenderScene(doc);
  const inferred = scene.nodes.find((n) => n.inferred);
  if (inferred === undefined) throw new Error("expected an inferred node");
  expect(inferred.qualifiedName).toBe("ex:ghostActivity");
  expect(inferred.kind).toBe("activity");
  expect(inferred.inferred).toBe(true);
  expect(inferred.attributes).toEqual([]);
});

test("unmappable inferred endpoints get kind 'unknown'", () => {
  const doc = newDoc();
  doc.entity(ex.qn("real"));
  // prov:influencer has no PROV-DM domain in INFERRED_ELEMENT_CLASS → unknown.
  doc.wasInfluencedBy(ex.qn("real"), ex.qn("mystery"));

  const scene = toRenderScene(doc);
  const mystery = scene.nodes.find((n) => n.qualifiedName === "ex:mystery");
  if (mystery === undefined) throw new Error("expected the influencer node");
  expect(mystery.kind).toBe("unknown");
  expect(mystery.inferred).toBe(true);
});

test("a mentionOf bundle endpoint infers kind 'bundle'", () => {
  const doc = newDoc();
  doc.entity(ex.qn("specific"));
  doc.entity(ex.qn("general"));
  // mentionOf(specificEntity, generalEntity, bundle) — the bundle endpoint is a
  // reference, inferred with kind "bundle" (INFERRED_ELEMENT_CLASS[prov:bundle]).
  doc.mentionOf(ex.qn("specific"), ex.qn("general"), ex.qn("theBundle"));

  const scene = toRenderScene(doc);
  const bundleEndpoint = scene.nodes.find(
    (n) => n.qualifiedName === "ex:theBundle",
  );
  if (bundleEndpoint === undefined) throw new Error("expected the bundle node");
  expect(bundleEndpoint.kind).toBe("bundle");
  expect(bundleEndpoint.inferred).toBe(true);
});

test("sub-bundles become scene bundles and mark their members", () => {
  const doc = newDoc();
  doc.entity(ex.qn("top"));
  const sub = doc.bundle(ex.qn("subBundle"));
  const inner = sub.entity(ex.qn("inner"));
  const innerAct = sub.activity(ex.qn("innerAct"));
  inner.wasGeneratedBy(innerAct);

  const scene = toRenderScene(doc);

  expect(scene.bundles).toEqual([
    { id: "c1", label: "ex:subBundle", uri: "http://example.org/subBundle" },
  ]);
  expect(nodeById(scene.nodes, "n1").bundleId).toBeUndefined(); // top-level
  const innerNode = scene.nodes.find((n) => n.qualifiedName === "ex:inner");
  const innerActNode = scene.nodes.find(
    (n) => n.qualifiedName === "ex:innerAct",
  );
  expect(innerNode?.bundleId).toBe("c1");
  expect(innerActNode?.bundleId).toBe("c1");
});

test("under-specified relations are skipped observably", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("orphan"));
  // Generation with no activity: entity set, activity unset → only one resolvable
  // endpoint. dot.py would draw it to a blank node; the scene omits blank nodes and
  // records the skip instead.
  e.wasGeneratedBy();

  const scene = toRenderScene(doc);
  expect(scene.edges).toEqual([]);
  expect(scene.skipped).toEqual([
    {
      relation: "prov:Generation",
      identifier: null,
      reason: "relation has fewer than two resolvable endpoints",
    },
  ]);
});

test("projection is deterministic and non-mutating", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[ex.qn("note"), "hi"]]);
  const a = doc.activity(ex.qn("a"));
  e.wasGeneratedBy(a);
  doc.wasDerivedFrom(ex.qn("e"), ex.qn("e0"), ex.qn("a"));

  const keysBefore = doc.getRecords().map((r) => r.key);
  const first = JSON.stringify(toRenderScene(doc));
  const second = JSON.stringify(toRenderScene(doc));
  const keysAfter = doc.getRecords().map((r) => r.key);

  expect(first).toBe(second);
  expect(keysAfter).toEqual(keysBefore);
});

test("useLabels swaps display text but keeps the qualified name", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[PROV_LABEL, "Human Readable"]]);
  e.wasAttributedTo(ex.qn("someone"));

  const withoutLabels = toRenderScene(doc);
  expect(nodeById(withoutLabels.nodes, "n1").label).toBe("ex:e");

  const withLabels = toRenderScene(doc, { useLabels: true });
  const labelled = nodeById(withLabels.nodes, "n1");
  expect(labelled.label).toBe("Human Readable");
  expect(labelled.qualifiedName).toBe("ex:e"); // identifier is unchanged
});

test("include-attribute toggles gate element and relation attributes", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[ex.qn("colour"), "blue"]]);
  const a = doc.activity(ex.qn("a"));
  e.wasGeneratedBy(a, undefined, [[ex.qn("via"), "cron"]]);

  const full = toRenderScene(doc);
  expect(nodeById(full.nodes, "n1").attributes).toEqual([
    { name: "ex:colour", nameUri: "http://example.org/colour", value: "blue" },
  ]);
  expect(edgeByRelation(full.edges, "prov:Generation").attributes).toEqual([
    { name: "ex:via", nameUri: "http://example.org/via", value: "cron" },
  ]);

  const noElementAttrs = toRenderScene(doc, {
    includeElementAttributes: false,
  });
  expect(nodeById(noElementAttrs.nodes, "n1").attributes).toEqual([]);
  // Relation attributes still present when only element attributes are off.
  expect(
    edgeByRelation(noElementAttrs.edges, "prov:Generation").attributes.length,
  ).toBe(1);

  const noRelationAttrs = toRenderScene(doc, {
    includeRelationAttributes: false,
  });
  expect(
    edgeByRelation(noRelationAttrs.edges, "prov:Generation").attributes,
  ).toEqual([]);
});

test("an identifier-valued attribute exposes its dereferenceable URI", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[ex.qn("seeAlso"), ex.qn("other")]]);
  e.wasAttributedTo(ex.qn("agent"));

  const scene = toRenderScene(doc);
  const attr = nodeById(scene.nodes, "n1").attributes[0];
  expect(attr).toEqual({
    name: "ex:seeAlso",
    nameUri: "http://example.org/seeAlso",
    value: "ex:other",
    valueUri: "http://example.org/other",
  });
});
