import { test, expect } from "bun:test";
import { ProvDocument, ns, PROV_LABEL, PROV_TYPE } from "@inflexa-ai/tsprov";
import { PROV_THEME, type ProvTheme } from "@inflexa-ai/tsprov-render-core";

import { DotRenderer } from "./dot.js";

const ex = ns("ex", "http://example.org/");

/** A fresh document with the `ex` namespace registered, matching the fixtures. */
function newDoc(): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  return doc;
}

const renderer = new DotRenderer();

/** Renders and returns the DOT source (the renderer is synchronous for DOT). */
function render(doc: ProvDocument, options?: Parameters<DotRenderer["render"]>[1]): string {
  const out = renderer.render(doc, options);
  if (typeof out !== "string") throw new Error("DOT render must be synchronous");
  return out;
}

/** The set of statement lines (trimmed, non-empty) — order-independent structural assertions. */
function lines(dot: string): string[] {
  return dot.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

test("format identifier is 'dot'", () => {
  expect(renderer.format).toBe("dot");
});

test("primer triangle renders with reference element and relation styling", () => {
  const doc = newDoc();
  const article = doc.entity(ex.qn("article"));
  const edit = doc.activity(ex.qn("edit"));
  const alice = doc.agent(ex.qn("alice"));
  article.wasGeneratedBy(edit);
  edit.wasAssociatedWith(alice);
  article.wasAttributedTo(alice);

  const dot = render(doc);
  const ls = lines(dot);

  // Header: digraph + rankdir + charset.
  expect(ls[0]).toBe("digraph G {");
  expect(ls).toContain("rankdir=BT;");
  expect(ls).toContain('charset="utf-8";');

  // Entity: oval #FFFC87 with a URL; activity: box #9FB1FC; agent: house #FED37F.
  expect(ls).toContain(
    'n1 [label="ex:article", URL="http://example.org/article", shape=oval, style=filled, fillcolor="#FFFC87", color="#808080"];',
  );
  expect(ls).toContain(
    'n2 [label="ex:edit", URL="http://example.org/edit", shape=box, style=filled, fillcolor="#9FB1FC", color="#0000FF"];',
  );
  expect(ls).toContain(
    'n3 [label="ex:alice", URL="http://example.org/alice", shape=house, style=filled, fillcolor="#FED37F"];',
  );

  // wasGeneratedBy is a plain binary edge (entity → activity), darkgreen.
  expect(ls).toContain(
    "n1 -> n2 [label=wasGeneratedBy, fontsize=10.0, color=darkgreen, fontcolor=darkgreen];",
  );
  // wasAssociatedWith is a 3-slot relation with the plan unset: the scene resolves
  // two endpoints, so it emits as a simple binary edge (no blank node), tinted #FED37F.
  expect(ls).toContain('n2 -> n3 [label=wasAssociatedWith, fontsize=10.0, color="#FED37F"];');
  expect(ls).toContain('n1 -> n3 [label=wasAttributedTo, fontsize=10.0, color="#FED37F"];');
});

test("n-ary derivation routes through a point-shaped blank node with gray legs", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e2"));
  doc.entity(ex.qn("e1"));
  doc.activity(ex.qn("act"));
  // generatedEntity=e2, usedEntity=e1, activity=act, generation=gPoint (inferred).
  doc.wasDerivedFrom(ex.qn("e2"), ex.qn("e1"), ex.qn("act"), ex.qn("gPoint"));

  const ls = lines(render(doc));

  // One blank point node.
  const blank = ls.find((l) => l.includes("shape=point"));
  expect(blank).toBeDefined();
  expect(blank).toContain('label=""');
  expect(blank).toContain("color=gray");
  const bnodeId = blank?.split(" ")[0];
  if (bnodeId === undefined) throw new Error("no blank node id");

  // First segment keeps the label and gets arrowhead=none; second drops the label.
  const first = ls.find((l) => l.includes("-> " + bnodeId + " ") && l.includes("arrowhead=none"));
  expect(first).toContain("label=wasDerivedFrom");
  const second = ls.find((l) => l.startsWith(bnodeId + " -> ") && !l.includes("label="));
  expect(second).toBeDefined();

  // Extra legs are gray with the leg attribute's local part as the label.
  const legLines = ls.filter(
    (l) => l.startsWith(bnodeId + " -> ") && l.includes("color=gray") && l.includes("fontcolor=dimgray"),
  );
  const legRoles = legLines.map((l) => (l.match(/label=([A-Za-z0-9_]+)/) ?? [])[1]).sort();
  expect(legRoles).toEqual(["activity", "generation"]);

  // showNary:false collapses to a simple binary edge (no blank node).
  const noNary = lines(render(doc, { showNary: false }));
  expect(noNary.some((l) => l.includes("shape=point"))).toBe(false);
  expect(noNary.some((l) => l.includes("-> ") && l.includes("label=wasDerivedFrom"))).toBe(true);
});

test("sub-bundles become cluster subgraphs labeled with the bundle identifier", () => {
  const doc = newDoc();
  doc.entity(ex.qn("top"));
  const sub = doc.bundle(ex.qn("subBundle"));
  const inner = sub.entity(ex.qn("inner"));
  const innerAct = sub.activity(ex.qn("innerAct"));
  inner.wasGeneratedBy(innerAct);

  const dot = render(doc);
  const ls = lines(dot);

  expect(ls).toContain("subgraph cluster_c1 {");
  expect(ls).toContain('URL="http://example.org/subBundle";');
  expect(ls).toContain('label="ex:subBundle";');
  // The sub-bundle's members are emitted inside the cluster block.
  const openIdx = ls.indexOf("subgraph cluster_c1 {");
  const closeIdx = ls.indexOf("}", openIdx);
  const inCluster = ls.slice(openIdx, closeIdx);
  expect(inCluster.some((l) => l.includes('label="ex:inner"'))).toBe(true);
  expect(inCluster.some((l) => l.includes('label="ex:innerAct"'))).toBe(true);
});

test("rendering the same document twice is byte-identical (deterministic)", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[ex.qn("note"), "hi"]]);
  const a = doc.activity(ex.qn("a"));
  e.wasGeneratedBy(a);
  doc.wasDerivedFrom(ex.qn("e"), ex.qn("e0"), ex.qn("a"));

  expect(render(doc)).toBe(render(doc));
});

test("an annotated entity gets a shape=note node with href'd rows and a dashed link", () => {
  const doc = newDoc();
  // prov:type (a QName value → href on the value cell) + an Identifier-valued custom
  // attribute (href) + a plain string attribute (no value href).
  const e = doc.entity(ex.qn("doc"), [
    [PROV_TYPE, ex.qn("Report")],
    [ex.qn("author"), ex.qn("alice")],
    [ex.qn("version"), "3"],
  ]);
  e.wasAttributedTo(ex.qn("someone"));

  const dot = render(doc);
  const ls = lines(dot);

  // The note node.
  expect(ls.some((l) => l.includes("shape=note") && l.includes("color=gray"))).toBe(true);
  // Attribute name cell links to the attribute URI; QName value cell links to its URI.
  expect(dot).toContain('<TD align="left" href="http://www.w3.org/ns/prov#type">prov:type</TD>');
  expect(dot).toContain('<TD align="left" href="http://example.org/Report">ex:Report</TD>');
  expect(dot).toContain('<TD align="left" href="http://example.org/alice">ex:alice</TD>');
  // A plain (non-identifier) value cell has no href.
  expect(dot).toContain('<TD align="left">3</TD>');
  // A dashed, arrowhead-less gray link from the note to the entity node.
  expect(ls.some((l) => /^ann\d+ -> n\d+ \[arrowhead=none, style=dashed, color=gray\];$/.test(l))).toBe(true);
});

test("both attribute toggles off suppress every annotation node and dashed link", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[ex.qn("colour"), "blue"]]);
  const a = doc.activity(ex.qn("a"));
  e.wasGeneratedBy(a, undefined, [[ex.qn("via"), "cron"]]);

  const dot = render(doc, {
    includeElementAttributes: false,
    includeRelationAttributes: false,
  });
  expect(dot).not.toContain("shape=note");
  expect(dot).not.toContain("style=dashed");
  // With no relation attributes and only two endpoints, the relation is a plain edge.
  expect(dot).not.toContain("shape=point");
});

test("HTML-label cells escape &, <, >, \" and ' like Python html.escape", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e"), [[ex.qn("danger"), 'a & b < c > d " e \' f']]);

  const dot = render(doc);
  expect(dot).toContain('<TD align="left">a &amp; b &lt; c &gt; d &quot; e &#x27; f</TD>');
});

test("direction and theme overrides apply while untouched styles keep reference values", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e"));
  doc.activity(ex.qn("a"));

  const theme: Partial<ProvTheme> = {
    nodes: {
      ...PROV_THEME.nodes,
      entity: { ...PROV_THEME.nodes.entity, fillcolor: "#123456" },
    },
  };
  const ls = lines(render(doc, { direction: "LR", theme }));

  expect(ls).toContain("rankdir=LR;");
  // Entity uses the overridden fill; activity keeps the reference fill.
  expect(ls.some((l) => l.includes('label="ex:e"') && l.includes('fillcolor="#123456"'))).toBe(true);
  expect(ls.some((l) => l.includes('label="ex:a"') && l.includes('fillcolor="#9FB1FC"'))).toBe(true);
});

test("an out-of-range direction from an untyped caller falls back to BT", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e"));
  // Force an invalid runtime value past the type system, mirroring a JS caller.
  const ls = lines(render(doc, { direction: "sideways" as unknown as "BT" }));
  expect(ls).toContain("rankdir=BT;");
});

test("useLabels emits the two-line HTML label when label and identifier differ", () => {
  const doc = newDoc();
  doc.entity(ex.qn("article"), [[PROV_LABEL, "Draft Article"]]);

  const withLabels = render(doc, { useLabels: true });
  expect(withLabels).toContain(
    '<Draft Article<br /><font color="#333333" point-size="10">ex:article</font>>',
  );

  // Without useLabels the node keeps a plain quoted identifier label.
  const withoutLabels = render(doc);
  expect(withoutLabels).toContain('label="ex:article"');
  expect(withoutLabels).not.toContain("<br />");
});

test("a node whose label equals its identifier stays single-line even under useLabels", () => {
  const doc = newDoc();
  doc.entity(ex.qn("plain"));

  const dot = render(doc, { useLabels: true });
  expect(dot).toContain('label="ex:plain"');
  expect(dot).not.toContain("<br />");
});

test("useLabels entity-escapes a hostile prov:label so it cannot forge DOT", () => {
  const doc = newDoc();
  // A label crafted to close the `<…>` HTML-like label early and inject a live URL sink
  // that would bypass safeLinkUri — the exact escape the reference's raw interpolation misses.
  const payload = 'x>]; forged [URL="javascript:alert(1)"';
  doc.entity(ex.qn("article"), [[PROV_LABEL, payload]]);

  const dot = render(doc, { useLabels: true });

  // The payload's `>` and `"` are entity-escaped, so it stays inert label text: the `<…>`
  // label is not terminated early and no forged `URL=` attribute (hence no javascript: sink).
  expect(dot).toContain(
    '<x&gt;]; forged [URL=&quot;javascript:alert(1)&quot;<br /><font color="#333333" point-size="10">ex:article</font>>',
  );
  expect(dot).not.toContain('URL="javascript:alert(1)"');
  // The emitter's OWN structural markup stays live (not escaped).
  expect(dot).toContain("<br />");
  expect(dot).toContain('<font color="#333333" point-size="10">');
});

test("a normal two-line useLabels label keeps its literal <br /> and <font> structure", () => {
  const doc = newDoc();
  doc.entity(ex.qn("article"), [[PROV_LABEL, "Draft Article"]]);

  const dot = render(doc, { useLabels: true });
  // Plain-text labels have no `&<>`, so escaping is a no-op and the structural markup is verbatim.
  expect(dot).toContain(
    '<Draft Article<br /><font color="#333333" point-size="10">ex:article</font>>',
  );
});
