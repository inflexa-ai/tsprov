import { test, expect } from "bun:test";
import { ProvDocument, ns, PROV_LABEL, PROV_TYPE } from "@inflexa-ai/tsprov";
import { PROV_THEME, type ProvTheme } from "@inflexa-ai/tsprov-render-core";

import { SvgRenderer } from "./svg.js";

const ex = ns("ex", "http://example.org/");

/** A fresh document with the `ex` namespace registered, matching the fixtures. */
function newDoc(): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  return doc;
}

const renderer = new SvgRenderer();

/** Renders and returns the SVG source (the renderer is synchronous). */
function render(doc: ProvDocument, options?: Parameters<SvgRenderer["render"]>[1]): string {
  const out = renderer.render(doc, options);
  if (typeof out !== "string") throw new Error("SVG render must be synchronous");
  return out;
}

/**
 * A dependency-free well-formedness check mirroring the eval's: walk the string, balance
 * tags, and reject an unquoted/malformed attribute or an unescaped `&`/`<`. Returns the
 * first error, or `null` when well-formed.
 */
function wellFormedError(svg: string): string | null {
  const stack: string[] = [];
  let i = 0;
  while (i < svg.length) {
    const lt = svg.indexOf("<", i);
    if (lt === -1) return textError(svg.slice(i));
    const textErr = textError(svg.slice(i, lt));
    if (textErr !== null) return textErr;
    const gt = svg.indexOf(">", lt);
    if (gt === -1) return `unterminated tag at ${lt}`;
    const tag = svg.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      if (stack.pop() !== name) return `unbalanced </${name}>`;
      continue;
    }
    const selfClose = tag.endsWith("/");
    const body = selfClose ? tag.slice(0, -1) : tag;
    const m = body.match(/^([\w:-]+)([\s\S]*)$/);
    if (m === null || m[1] === undefined) return `bad tag <${tag}>`;
    const attrErr = attrError(m[2] ?? "");
    if (attrErr !== null) return `<${m[1]}>: ${attrErr}`;
    if (!selfClose) stack.push(m[1]);
  }
  return stack.length === 0 ? null : `unclosed: ${stack.join(",")}`;
}
function textError(text: string): string | null {
  return /&(?!(amp|lt|gt|quot|#39|#\d+);)/.test(text) ? "unescaped &" : null;
}
function attrError(attrs: string): string | null {
  let rest = attrs.trim();
  while (rest.length > 0) {
    const m = rest.match(/^([\w:-]+)\s*=\s*"([^"]*)"\s*/);
    if (m === null || m[2] === undefined) return `malformed attribute near ${JSON.stringify(rest.slice(0, 32))}`;
    if (m[2].includes("<")) return "raw < in attribute";
    if (textError(m[2]) !== null) return "unescaped & in attribute";
    rest = rest.slice(m[0].length);
  }
  return null;
}

/** The `<g class="prov-edge">…</g>` group whose label text is `label`. */
function edgeGroupWithLabel(svg: string, label: string): string | undefined {
  return svg
    .split("\n")
    .find((line) => line.startsWith('<g class="prov-edge">') && line.includes(`>${label}</text>`));
}

test("format identifier is 'svg'", () => {
  expect(renderer.format).toBe("svg");
});

test("primer triangle renders reference glyphs, colors, and tinted arrowed edges", () => {
  const doc = newDoc();
  const article = doc.entity(ex.qn("article"));
  const edit = doc.activity(ex.qn("edit"));
  const alice = doc.agent(ex.qn("alice"));
  article.wasGeneratedBy(edit);
  edit.wasAssociatedWith(alice);
  article.wasAttributedTo(alice);

  const svg = render(doc);

  // Entity ellipse (#FFFC87/#808080), activity rect (#9FB1FC/#0000FF), agent house (#FED37F).
  expect(svg).toContain('<ellipse');
  expect(svg).toContain('fill="#FFFC87" stroke="#808080"');
  expect(svg).toContain('fill="#9FB1FC" stroke="#0000FF"');
  expect(svg).toMatch(/<polygon points="[^"]+" fill="#FED37F"\/>/);

  // Three labeled edges, each with the theme tint.
  expect(svg).toContain(">wasGeneratedBy</text>");
  expect(svg).toContain(">wasAssociatedWith</text>");
  expect(svg).toContain(">wasAttributedTo</text>");
  // Generation is darkgreen; attribution/association are #FED37F.
  expect(svg).toContain('stroke="darkgreen"');
  expect(svg).toContain('stroke="#FED37F"');

  // Arrowheads: one deduped marker per stroke color, referenced by the edges.
  expect(svg).toContain('<marker id="arrow-darkgreen"');
  expect(svg).toContain('<marker id="arrow-FED37F"');
  expect(svg).toContain('marker-end="url(#arrow-darkgreen)"');
});

test("output is a standalone, well-formed SVG with no external references", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[ex.qn("k"), "v"]]);
  e.wasAttributedTo(ex.qn("someone"));
  const svg = render(doc);

  expect(svg.startsWith("<svg ")).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('viewBox="0 0 ');
  // No intrinsic size (scales to container) and a transparent background (no full rect).
  expect(/<svg[^>]*\swidth=/.test(svg)).toBe(false);
  expect(/<svg[^>]*\sheight=/.test(svg)).toBe(false);
  // No external references of any kind.
  expect(/<image\b|<script\b|xlink:href|@import|\ssrc=|<use\b|url\(https?:/.test(svg)).toBe(false);
  expect(wellFormedError(svg)).toBeNull();
});

test("a nodeless (all-skipped, D15) document still yields a finite viewBox", () => {
  const doc = newDoc();
  // wasStartedBy with only an activity → fewer than two resolvable endpoints → skipped.
  doc.activity(ex.qn("a")).wasStartedBy(undefined);
  // Nothing declared besides the activity above; render a truly empty projection.
  const empty = newDoc();
  const svg = render(empty);
  const vb = svg.match(/viewBox="([^"]*)"/)?.[1] ?? "";
  const nums = vb.split(" ").map(Number);
  expect(nums.length).toBe(4);
  expect(nums.every((n) => Number.isFinite(n))).toBe(true);
  expect(wellFormedError(svg)).toBeNull();
  expect(render(doc)).toContain("viewBox=");
});

test("bundle members sit inside a labeled aliceblue rounded rect drawn behind them", () => {
  const doc = newDoc();
  doc.entity(ex.qn("top"));
  const sub = doc.bundle(ex.qn("subBundle"));
  const inner = sub.entity(ex.qn("inner"));
  const innerAct = sub.activity(ex.qn("innerAct"));
  inner.wasGeneratedBy(innerAct);

  const svg = render(doc);
  const lines = svg.split("\n");
  const bundleLine = lines.find((l) => l.startsWith('<g class="prov-bundle">'));
  expect(bundleLine).toBeDefined();
  expect(bundleLine).toContain('fill="aliceblue"');
  expect(bundleLine).toMatch(/<rect[^>]*rx="8"/);
  expect(bundleLine).toContain(">ex:subBundle</text>");

  // Paint order: the bundle group precedes every element node group (drawn behind).
  const bundleIdx = lines.findIndex((l) => l.startsWith('<g class="prov-bundle">'));
  const firstNodeIdx = lines.findIndex((l) => l.includes('class="prov-node'));
  expect(bundleIdx).toBeGreaterThanOrEqual(0);
  expect(bundleIdx).toBeLessThan(firstNodeIdx);
});

test("a node carries a <title> with its qualified name + attribute rows and an <a href>", () => {
  const doc = newDoc();
  doc.entity(ex.qn("doc"), [
    [PROV_TYPE, ex.qn("Report")],
    [ex.qn("version"), "3"],
  ]);

  const svg = render(doc);
  // Tooltip: qualified name then one `name = value` row per attribute (newline-joined).
  expect(svg).toContain("<title>ex:doc\nprov:type = ex:Report\nex:version = 3</title>");
  // The node is wrapped in a link to its URI (SVG2 bare href).
  expect(svg).toContain('<a href="http://example.org/doc"><g class="prov-node prov-entity">');
});

test("an annotated relation splits through a join circle; the first segment is marker-less (D18)", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"));
  const a = doc.activity(ex.qn("a"));
  // A 2-slot generation carrying a non-formal attribute forces a blank join node.
  e.wasGeneratedBy(a, undefined, [[ex.qn("tool"), "vim"]]);

  const svg = render(doc);
  expect(svg).toContain('<g class="prov-blank"><circle');
  // The labeled first segment (source → circle) carries NO arrowhead marker.
  const firstSeg = edgeGroupWithLabel(svg, "wasGeneratedBy");
  expect(firstSeg).toBeDefined();
  expect(firstSeg).not.toContain("marker-end");
  // Exactly one darkgreen arrowhead is referenced — the second segment (circle → target).
  expect((svg.match(/marker-end="url\(#arrow-darkgreen\)"/g) ?? []).length).toBe(1);
  // The annotation note + its dashed, marker-less link.
  expect(svg).toContain('<g class="prov-annotation">');
  expect(svg).toContain(">ex:tool = vim</tspan>");
  expect(svg).toMatch(/<path d="[^"]*" fill="none" stroke="gray"[^>]*stroke-dasharray="4 3"/);
});

test("a full n-ary derivation routes through a circle with gray labeled legs", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e2"));
  doc.entity(ex.qn("e1"));
  doc.activity(ex.qn("act"));
  doc.wasDerivedFrom(ex.qn("e2"), ex.qn("e1"), ex.qn("act"), ex.qn("gPoint"));

  const svg = render(doc);
  expect(svg).toContain('<g class="prov-blank"><circle');
  // Legs are gray, arrowed, and labeled with the endpoint's role.
  expect(svg).toContain('<marker id="arrow-gray"');
  expect(svg).toContain(">activity</text>");
  expect(svg).toContain(">generation</text>");
  const legGroup = edgeGroupWithLabel(svg, "activity");
  expect(legGroup).toContain('stroke="gray"');
  expect(legGroup).toContain('fill="dimgray"');

  // showNary:false collapses to a single direct edge — no join circle.
  const noNary = render(doc, { showNary: false });
  expect(noNary).not.toContain('class="prov-blank"');
  expect(noNary).toContain(">wasDerivedFrom</text>");
});

test("a plain two-endpoint association is a single direct edge — no join circle (D18)", () => {
  const doc = newDoc();
  const edit = doc.activity(ex.qn("edit"));
  const alice = doc.agent(ex.qn("alice"));
  // wasAssociatedWith is a >2-slot relation; with the plan unset it must NOT split.
  edit.wasAssociatedWith(alice);

  const svg = render(doc);
  expect(svg).not.toContain('class="prov-blank"');
  const seg = edgeGroupWithLabel(svg, "wasAssociatedWith");
  expect(seg).toBeDefined();
  expect(seg).toContain("marker-end"); // a direct edge keeps its arrowhead
});

test("inferred endpoints get the gray generic fill; unknown legs stay gray", () => {
  const doc = newDoc();
  // hadMember with an undeclared collection + member → both endpoints inferred (gray).
  doc.hadMember(ex.qn("coll"), ex.qn("m1"));

  const svg = render(doc);
  // Two gray ellipses, no colored entity fill.
  expect((svg.match(/fill="lightgray" stroke="dimgray"/g) ?? []).length).toBe(2);
  expect(svg).not.toContain('fill="#FFFC87"');
  // Both carry the inferred class hook.
  expect((svg.match(/class="prov-node prov-entity prov-inferred"/g) ?? []).length).toBe(2);
});

test("useLabels emits a two-line label only when label and identifier differ", () => {
  const doc = newDoc();
  doc.entity(ex.qn("article"), [[PROV_LABEL, "Draft Article"]]);
  doc.entity(ex.qn("plain"));

  const svg = render(doc, { useLabels: true });
  // Two tspans (label over identifier) for the labeled entity.
  expect(svg).toContain(">Draft Article</tspan>");
  expect(svg).toMatch(/>Draft Article<\/tspan><tspan[^>]*>ex:article<\/tspan>/);
  // A node whose label equals its identifier stays single-line.
  expect(svg).toMatch(/<tspan x="[^"]*" dy="0">ex:plain<\/tspan><\/text>/);
});

test("dangerous attribute/text values are XML-escaped, keeping the SVG well-formed", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e"), [[ex.qn("danger"), 'a & b < c > d " e']]);

  const svg = render(doc);
  expect(svg).toContain("a &amp; b &lt; c &gt; d &quot; e");
  expect(wellFormedError(svg)).toBeNull();
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
  const svg = render(doc, { direction: "LR", theme });
  expect(svg).toContain('fill="#123456" stroke="#808080"');
  expect(svg).toContain('fill="#9FB1FC" stroke="#0000FF"');
});

test("an out-of-range direction from an untyped caller falls back to BT (no throw)", () => {
  const doc = newDoc();
  doc.entity(ex.qn("e"));
  doc.activity(ex.qn("a"));
  doc.entity(ex.qn("e")).wasGeneratedBy(ex.qn("a"));
  // Force an invalid runtime value past the type system, mirroring a JS caller.
  const svg = render(doc, { direction: "sideways" as unknown as "BT" });
  expect(svg.startsWith("<svg ")).toBe(true);
});

test("the `used` relation's Graphviz-only red4 stroke is projected to a browser-legal hex", () => {
  const doc = newDoc();
  const a = doc.activity(ex.qn("a"));
  a.used(ex.qn("e"));

  const svg = render(doc);
  // red4 is not a valid SVG color; it must be projected to its X11 hex.
  expect(svg).toContain('stroke="#8B0000"');
  expect(svg).not.toContain('stroke="red4"');
  // The label color `red` is already valid CSS and passes through.
  expect(svg).toContain('fill="red">used</text>');
});

test("rendering the same document twice is byte-identical (deterministic)", () => {
  const doc = newDoc();
  const e = doc.entity(ex.qn("e"), [[ex.qn("note"), "hi"]]);
  const a = doc.activity(ex.qn("a"));
  e.wasGeneratedBy(a);
  doc.wasDerivedFrom(ex.qn("e"), ex.qn("e0"), ex.qn("a"));

  expect(render(doc)).toBe(render(doc));
});
