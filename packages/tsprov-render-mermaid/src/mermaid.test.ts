import { test, expect } from "bun:test";
import { ProvDocument, ns, PROV_LABEL, PROV_TYPE } from "@inflexa-ai/tsprov";
import { PROV_THEME, type ProvTheme } from "@inflexa-ai/tsprov-render-core";

import { MermaidRenderer } from "./mermaid.js";

const ex = ns("ex", "http://example.org/");

/** A fresh document with the `ex` namespace registered, matching the fixtures. */
function newDoc(): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  return doc;
}

const renderer = new MermaidRenderer();

/** Renders and returns the Mermaid source (the renderer is synchronous). */
function render(doc: ProvDocument, options?: Parameters<MermaidRenderer["render"]>[1]): string {
  const out = renderer.render(doc, options);
  if (typeof out !== "string") throw new Error("Mermaid render must be synchronous");
  return out;
}

/** The set of statement lines (trimmed, non-empty). */
function lines(mmd: string): string[] {
  return mmd.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

test("format identifier is 'mermaid'", () => {
  expect(renderer.format).toBe("mermaid");
});

test("primer triangle renders with reference shapes, classDefs, and index-aligned tints", () => {
  const doc = newDoc();
  const article = doc.entity(ex.qn("article"));
  const edit = doc.activity(ex.qn("edit"));
  const alice = doc.agent(ex.qn("alice"));
  article.wasGeneratedBy(edit);
  edit.wasAssociatedWith(alice);
  article.wasAttributedTo(alice);

  const ls = lines(render(doc));

  // Header.
  expect(ls[0]).toBe("flowchart BT");

  // Stadium entity, rect activity, hexagon agent, each tagged with its kind class.
  expect(ls).toContain('n1(["ex:article"]):::entity');
  expect(ls).toContain('n2["ex:edit"]:::activity');
  expect(ls).toContain('n3{{"ex:alice"}}:::agent');

  // classDefs carry the reference fills + strokes; agent has no stroke.
  expect(ls).toContain("classDef entity fill:#FFFC87,stroke:#808080");
  expect(ls).toContain("classDef activity fill:#9FB1FC,stroke:#0000FF");
  expect(ls).toContain("classDef agent fill:#FED37F");

  // Three labeled edges (wasAssociatedWith has an unset plan → binary, no blank node).
  expect(ls).toContain("n1 -->|wasGeneratedBy| n2");
  expect(ls).toContain("n2 -->|wasAssociatedWith| n3");
  expect(ls).toContain("n1 -->|wasAttributedTo| n3");

  // Edge tints, index-aligned to emission order.
  expect(ls).toContain("linkStyle 0 stroke:darkgreen,color:darkgreen");
  expect(ls).toContain("linkStyle 1 stroke:#FED37F");
  expect(ls).toContain("linkStyle 2 stroke:#FED37F");

  // Click-through links for every node URI.
  expect(ls).toContain('click n1 href "http://example.org/article" _blank');
});

test("edge tints align with edge order; untinted edges get no linkStyle line", () => {
  const doc = newDoc();
  const article = doc.entity(ex.qn("article"));
  const edit = doc.activity(ex.qn("edit"));
  const build = doc.activity(ex.qn("build"));
  const alice = doc.agent(ex.qn("alice"));
  // Emission order (relations processed in record order, all binary → link indices 0..3):
  //   0 generation (darkgreen)  1 communication (untinted)
  //   2 attribution (#FED37F)   3 usage (red4→#8B0000 / red)
  article.wasGeneratedBy(edit);
  edit.wasInformedBy(build);
  article.wasAttributedTo(alice);
  edit.used(article);

  const ls = lines(render(doc));

  expect(ls).toContain("linkStyle 0 stroke:darkgreen,color:darkgreen");
  // Index 1 (communication) is untinted — no linkStyle line names it.
  expect(ls.some((l) => l.startsWith("linkStyle 1 "))).toBe(false);
  expect(ls).toContain("linkStyle 2 stroke:#FED37F");
  // Usage's Graphviz-only stroke `red4` is projected to its X11 hex so it survives CSS.
  expect(ls).toContain("linkStyle 3 stroke:#8B0000,color:red");

  // Exactly three linkStyle lines, for indices {0,2,3}.
  const styled = ls.filter((l) => l.startsWith("linkStyle ")).map((l) => l.split(" ")[1]);
  expect(styled.sort()).toEqual(["0", "2", "3"]);
});

test("a full n-ary derivation routes through a circle blank node with gray legs", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e2"));
  doc.entity(ex.qn("e1"));
  doc.activity(ex.qn("act"));
  // generatedEntity=e2, usedEntity=e1, activity=act, generation=gPoint (inferred).
  doc.wasDerivedFrom(ex.qn("e2"), ex.qn("e1"), ex.qn("act"), ex.qn("gPoint"));

  const ls = lines(render(doc));

  // One circle blank node, styled bnode.
  const blank = ls.find((l) => /^b\d+\(\(" "\)\):::bnode$/.test(l));
  expect(blank).toBeDefined();
  const bnodeId = blank?.split("(")[0];
  if (bnodeId === undefined) throw new Error("no blank node id");

  // First segment is an arrowless open link keeping the label; second drops the label.
  expect(ls).toContain(`n1 ---|wasDerivedFrom| ${bnodeId}`);
  expect(ls).toContain(`${bnodeId} --> n2`);

  // Extra legs are gray, labeled with the leg's local part, each with a gray linkStyle.
  const legs = ls.filter((l) => new RegExp(`^${bnodeId} -->\\|(activity|generation)\\| n\\d+$`).test(l));
  expect(legs.length).toBe(2);
  // The two leg links (indices 2 and 3) each carry the gray tint.
  const grayStyles = ls.filter((l) => l === "linkStyle 2 stroke:gray,color:dimgray" || l === "linkStyle 3 stroke:gray,color:dimgray");
  expect(grayStyles.length).toBe(2);

  // showNary:false collapses to a single direct edge — no blank node.
  const noNary = lines(render(doc, { showNary: false }));
  expect(noNary.some((l) => l.includes(':::bnode'))).toBe(false);
  expect(noNary).toContain("n1 -->|wasDerivedFrom| n2");
});

test("a plain two-endpoint association is a single direct edge — no blank node (D18)", () => {
  const doc = newDoc();
  const edit = doc.activity(ex.qn("edit"));
  const alice = doc.agent(ex.qn("alice"));
  // wasAssociatedWith is a >2-slot relation; with the plan unset it must NOT split.
  edit.wasAssociatedWith(alice);

  const ls = lines(render(doc));
  expect(ls.some((l) => l.includes(":::bnode"))).toBe(false);
  expect(ls).toContain("n1 -->|wasAssociatedWith| n2");
});

test("sub-bundles become subgraphs titled with the bundle identifier", () => {
  const doc = newDoc();
  doc.entity(ex.qn("top"));
  const sub = doc.bundle(ex.qn("subBundle"));
  const inner = sub.entity(ex.qn("inner"));
  const innerAct = sub.activity(ex.qn("innerAct"));
  inner.wasGeneratedBy(innerAct);

  const ls = lines(render(doc));

  const openIdx = ls.indexOf('subgraph c1["ex:subBundle"]');
  expect(openIdx).toBeGreaterThanOrEqual(0);
  const closeIdx = ls.indexOf("end", openIdx);
  expect(closeIdx).toBeGreaterThan(openIdx);
  const inSubgraph = ls.slice(openIdx, closeIdx);
  expect(inSubgraph.some((l) => l.includes('"ex:inner"'))).toBe(true);
  expect(inSubgraph.some((l) => l.includes('"ex:innerAct"'))).toBe(true);
});

test("an annotated entity gets a gray note rect on a dotted arrowless link", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("doc"), [
    [PROV_TYPE, ex.qn("Report")],
    [ex.qn("version"), "3"],
  ]);
  e.wasAttributedTo(ex.qn("someone"));

  const ls = lines(render(doc));

  // A rect whose rows are `name = value`, joined by <br/>, on the annotation classDef.
  const ann = ls.find((l) => /^ann\d+\[".*"\]:::annotation$/.test(l));
  expect(ann).toBeDefined();
  expect(ann).toContain("prov:type = ex:Report<br/>ex:version = 3");
  expect(ls).toContain("classDef annotation stroke:gray,color:black");
  // Dotted, arrowless link from the rect to the entity node.
  expect(ls.some((l) => /^ann\d+ -\.- n\d+$/.test(l))).toBe(true);

  // With element attributes off, the annotation rect and its link vanish.
  const off = render(doc, { includeElementAttributes: false });
  expect(off).not.toContain(":::annotation");
  expect(off).not.toContain(" -.- ");
});

test("a relation annotation attaches to the relation's blank node", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"));
  const a = doc.activity(ex.qn("a"));
  // A 2-slot generation carrying one non-formal attribute forces a blank node whose
  // sole purpose is to anchor the annotation.
  e.wasGeneratedBy(a, undefined, [[ex.qn("tool"), "vim"]]);

  const ls = lines(render(doc));
  const blank = ls.find((l) => /^b\d+\(\(" "\)\):::bnode$/.test(l));
  expect(blank).toBeDefined();
  const bnodeId = blank?.split("(")[0];
  const ann = ls.find((l) => /^ann\d+\[".*"\]:::annotation$/.test(l));
  expect(ann).toContain("ex:tool = vim");
  // The dotted link targets the blank node, not the element.
  expect(ls.some((l) => new RegExp(`^ann\\d+ -\\.- ${bnodeId}$`).test(l))).toBe(true);
});

test("annotation rows entity-escape arbitrary literals so <br/> structure survives", () => {
  const doc = newDoc();
  // A value with every char the escaper must neutralize, plus a newline and a tab.
  doc.entity(ex.qn("e"), [[ex.qn("danger"), 'a & b < c > d " e <br/> f\ng\th']]);

  const mmd = render(doc);
  // & < > " are entity-escaped; the literal <br/> becomes inert; newline+tab collapse
  // to a single space so the statement stays on one line.
  expect(mmd).toContain(
    'ex:danger = a &amp; b &lt; c &gt; d #quot; e &lt;br/&gt; f g h',
  );
  // The annotation node statement is a single line.
  const annLine = lines(mmd).find((l) => l.startsWith("ann1["));
  expect(annLine).toBeDefined();
  expect(annLine).not.toContain("\n");
});

test("node labels escape embedded quotes via #quot;", () => {
  const doc = newDoc();
  doc.entity(ex.qn("article"), [[PROV_LABEL, 'The "Best" Draft']]);

  const withLabels = render(doc, { useLabels: true });
  // The two-line label carries the escaped quote and the identifier subtitle.
  expect(withLabels).toContain('n1(["The #quot;Best#quot; Draft<br/>ex:article"]):::entity');
});

test("node labels entity-escape < > & so injected markup is inert; the two-line <br/> survives", () => {
  const doc = newDoc();
  // A prov:label carrying an HTML-injection payload plus a raw ampersand and quotes:
  // under useLabels this flows into a label span Mermaid renders as HTML, so every one of
  // these characters must land as an inert entity, not live markup.
  doc.entity(ex.qn("article"), [[PROV_LABEL, '<img src=x onerror=alert(1)> a & b "q"']]);

  const withLabels = render(doc, { useLabels: true });
  // The distinct label + identifier form the two-line label; the `<br/>` between them is
  // the caller's structural separator, inserted AFTER escaping each line, so it stays a
  // literal `<br/>` while the payload's own `<`/`>`/`&`/`"` are all entity-escaped.
  expect(withLabels).toContain(
    'n1(["&lt;img src=x onerror=alert(1)&gt; a &amp; b #quot;q#quot;<br/>ex:article"]):::entity',
  );
  const nodeLine = lines(withLabels).find((l) => l.startsWith("n1("));
  expect(nodeLine).toBeDefined();
  // No live markup: the only `<`/`>` left in the node line are the escaped entities and
  // the structural `<br/>` — the raw `<img …>` tag never survives.
  expect(nodeLine).not.toContain("<img");
  expect(nodeLine).not.toContain("onerror=alert(1)>");
});

test("useLabels emits the two-line label only when label and identifier differ", () => {
  const doc = newDoc();
  doc.entity(ex.qn("article"), [[PROV_LABEL, "Draft Article"]]);
  doc.entity(ex.qn("plain"));

  const withLabels = render(doc, { useLabels: true });
  expect(withLabels).toContain('n1(["Draft Article<br/>ex:article"]):::entity');
  // A node whose label equals its identifier stays single-line even under useLabels.
  expect(withLabels).toContain('n2(["ex:plain"]):::entity');

  const withoutLabels = render(doc);
  expect(withoutLabels).toContain('n1(["ex:article"]):::entity');
  expect(withoutLabels).not.toContain("<br/>");
});

test("inferred endpoints get gray generic classes; unknown legs are unknownInferred", () => {
  const doc = newDoc();
  // hadMember with an undeclared collection + members → all endpoints inferred (entity).
  doc.hadMember(ex.qn("coll"), ex.qn("m1"));

  const ls = lines(render(doc));
  expect(ls).toContain('n1(["ex:coll"]):::entityInferred');
  expect(ls).toContain('n2(["ex:m1"]):::entityInferred');
  expect(ls).toContain("classDef entityInferred fill:lightgray,stroke:dimgray");
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

  expect(ls[0]).toBe("flowchart LR");
  expect(ls).toContain("classDef entity fill:#123456,stroke:#808080");
  expect(ls).toContain("classDef activity fill:#9FB1FC,stroke:#0000FF");
});

test("an out-of-range direction from an untyped caller falls back to BT", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e"));
  // Force an invalid runtime value past the type system, mirroring a JS caller.
  const ls = lines(render(doc, { direction: "sideways" as unknown as "BT" }));
  expect(ls[0]).toBe("flowchart BT");
});

test("rendering the same document twice is byte-identical (deterministic)", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[ex.qn("note"), "hi"]]);
  const a = doc.activity(ex.qn("a"));
  e.wasGeneratedBy(a);
  doc.wasDerivedFrom(ex.qn("e"), ex.qn("e0"), ex.qn("a"));

  expect(render(doc)).toBe(render(doc));
});

test("only referenced classDefs are emitted, in canonical order", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e"));
  doc.agent(ex.qn("ag"));

  const ls = lines(render(doc));
  const classDefs = ls.filter((l) => l.startsWith("classDef "));
  // Only entity + agent are used; activity/bundle/inferred/annotation/bnode are absent.
  expect(classDefs).toEqual([
    "classDef entity fill:#FFFC87,stroke:#808080",
    "classDef agent fill:#FED37F",
  ]);
});
