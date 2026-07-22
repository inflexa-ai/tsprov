import { test, expect } from "bun:test";
import { ProvDocument, ns } from "@inflexa-ai/tsprov";
import type { ProvTheme } from "@inflexa-ai/tsprov-render-core";

import {
  renderInteractiveHtml,
  InteractiveRenderer,
  buildScenePayload,
  WHOLE_GRAPH_MAX,
  DISCLOSURE_HOPS,
  INITIAL_CAP,
  EXPAND_CAP,
} from "./interactive.js";
import { APP_JS } from "./template.generated.js";

// In-package tests for the static, non-browser contract of the interactive renderer:
// self-containment, determinism, the hostile-literal payload round-trip, the disclosure
// rule (≤ WHOLE_GRAPH_MAX whole graph vs focus + 2-hop), theme projection, and the
// Renderer wrapper. The animated behavior itself is proven once by the browser gate.

const ex = ns("ex", "http://example.org/");

/** The primer triangle: entity → activity → agent, with one element attribute. */
function triangle(): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  const e = doc.entity(ex.qn("article"), [[ex.qn("topic"), "provenance"]]);
  const a = doc.activity(ex.qn("edit"));
  const ag = doc.agent(ex.qn("bob"));
  doc.wasGeneratedBy(e, a);
  doc.wasAssociatedWith(a, ag);
  doc.wasAttributedTo(e, ag);
  return doc;
}

/** A chain of `n` entities, each derived from the previous — a large, LOCAL graph. */
function chain(n: number): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  const nodes = [];
  for (let i = 0; i < n; i++) nodes.push(doc.entity(ex.qn(`e${i}`)));
  for (let i = 1; i < n; i++) doc.wasDerivedFrom(nodes[i]!, nodes[i - 1]!);
  return doc;
}

/**
 * A star: one hub entity with `leaves` entities each derived from it — the degenerate
 * super-hub shape (like prov-inflexa.2's 141-degree node) whose single-hop neighbourhood alone
 * overflows {@link INITIAL_CAP}, so the initial set must clamp to the cap.
 */
function star(leaves: number): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  const hub = doc.entity(ex.qn("hub"));
  for (let i = 0; i < leaves; i++) {
    doc.wasDerivedFrom(doc.entity(ex.qn(`e${i}`)), hub);
  }
  return doc;
}

// The set of tokens that would load an EXTERNAL resource. Anchor `href`s to entity URIs are
// data (optional navigation), not resource loads, so they are deliberately NOT in this set —
// the file stays fully functional offline. Mirrors the eval's self-containment check.
const EXTERNAL_TOKENS = [
  /\ssrc\s*=/i,
  /<link\b/i,
  /@import\b/i,
  /url\(\s*['"]?https?:/i,
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i,
  /\bWebSocket\b/i,
  /\bEventSource\b/i,
  /\bimport\s*\(/i,
];

/** Strips the JSON payload block so its data (which may contain arbitrary URIs) is not scanned. */
function stripPayload(html: string): string {
  return html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, "");
}

test("output is self-contained: no external resource loads", () => {
  const html = renderInteractiveHtml(triangle());
  const chrome = stripPayload(html);
  for (const token of EXTERNAL_TOKENS) {
    expect(`${token} present: ${token.test(chrome)}`).toBe(`${token} present: false`);
  }
});

test("output is a full HTML document with the payload and inline app", () => {
  const html = renderInteractiveHtml(triangle());
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain('<script type="application/json" id="prov-scene">');
  expect(html.includes("__PROV_")).toBe(false); // every slot filled
});

test("output is deterministic: same doc + options → byte-identical HTML", () => {
  const doc = triangle();
  expect(renderInteractiveHtml(doc, { title: "X" })).toBe(renderInteractiveHtml(doc, { title: "X" }));
});

test("the embedded payload parses and byte-round-trips the built payload", () => {
  const doc = triangle();
  const opts = { title: "Round <trip> & \"test\"" };
  const html = renderInteractiveHtml(doc, opts);
  const match = html.match(/<script type="application\/json" id="prov-scene">([\s\S]*?)<\/script>/);
  if (match === null || match[1] === undefined) throw new Error("no payload script found");
  // JSON.parse decodes the < escapes back to `<`, so a valid parse is the round-trip.
  const parsed = JSON.parse(match[1]);
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(buildScenePayload(doc, opts)));
});

test("hostile literals never break out of the payload script", () => {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  // A value carrying </script>, quotes, unicode, and a control char.
  const hostile = "</script><svg onload=alert(1)> \"q  é";
  doc.entity(ex.qn("evil"), [[ex.qn("v"), hostile]]);
  const html = renderInteractiveHtml(doc);
  const match = html.match(/<script type="application\/json" id="prov-scene">([\s\S]*?)<\/script>/);
  if (match === null || match[1] === undefined) throw new Error("no payload script found");
  // The literal `</script` must NOT survive un-escaped inside the block.
  expect(/<\/script/i.test(match[1])).toBe(false);
  const parsed = JSON.parse(match[1]);
  expect(parsed.nodes[0].attributes[0].value).toBe(hostile);
});

test("small documents disclose the whole graph (≤ WHOLE_GRAPH_MAX)", () => {
  const payload = buildScenePayload(triangle());
  expect(payload.nodes.length).toBeLessThanOrEqual(WHOLE_GRAPH_MAX);
  expect(payload.meta.disclosure.wholeGraph).toBe(true);
  expect(payload.meta.disclosure.initialVisibleIds.length).toBe(payload.nodes.length);
});

test("large documents disclose a focus neighborhood, never the whole graph, capped at INITIAL_CAP", () => {
  const payload = buildScenePayload(chain(WHOLE_GRAPH_MAX + 20));
  expect(payload.nodes.length).toBeGreaterThan(WHOLE_GRAPH_MAX);
  const d = payload.meta.disclosure;
  expect(d.wholeGraph).toBe(false);
  expect(d.hops).toBe(DISCLOSURE_HOPS);
  const focusId = d.focusId;
  // A large graph always has a focus; narrow the `string | null` for the checks below.
  if (focusId === null) throw new Error("large graph must have a focus node");
  // A local chain around the focus reveals only a handful, never the whole graph, and never
  // more than the cap.
  expect(d.initialVisibleIds.length).toBeGreaterThan(0);
  expect(d.initialVisibleIds.length).toBeLessThanOrEqual(INITIAL_CAP);
  expect(d.initialVisibleIds.length).toBeLessThan(payload.nodes.length);
  expect(d.initialVisibleIds).toContain(focusId);
});

test("a super-hub focus clamps the initial set to exactly INITIAL_CAP (not the whole graph)", () => {
  // A hub with more direct neighbors than the cap — hop-1 alone overflows, so the initial
  // set is the focus plus its first INITIAL_CAP-1 neighbors in scene order = INITIAL_CAP.
  const payload = buildScenePayload(star(INITIAL_CAP + 20));
  expect(payload.nodes.length).toBeGreaterThan(WHOLE_GRAPH_MAX);
  const d = payload.meta.disclosure;
  expect(d.wholeGraph).toBe(false);
  expect(d.initialVisibleIds.length).toBe(INITIAL_CAP);
  // The clamp is a disclosure, not a truncation of the graph: everything is still present.
  expect(payload.nodes.length).toBeGreaterThan(INITIAL_CAP);
  const focusId = d.focusId;
  // A super-hub graph always has a focus; narrow the `string | null` for the check below.
  if (focusId === null) throw new Error("super-hub graph must have a focus node");
  expect(d.initialVisibleIds).toContain(focusId);
});

test("the client mirrors EXPAND_CAP verbatim (generator + client agree on the per-click cap)", () => {
  // EXPAND_CAP lives in two runtimes — the generator exports it; the client (app.js) enforces
  // it at click time. This asserts the client declares the SAME value, so the two never drift.
  expect(APP_JS).toContain(`var EXPAND_CAP = ${EXPAND_CAP};`);
});

test("an explicit focus option selects the initial-set center", () => {
  const payload = buildScenePayload(chain(WHOLE_GRAPH_MAX + 20), { focus: "ex:e40" });
  const focusNode = payload.nodes.find((n) => n.id === payload.meta.disclosure.focusId);
  expect(focusNode?.qualifiedName).toBe("ex:e40");
});

test("theme is embedded projected to browser-legal colors (Graphviz red4 → hex)", () => {
  const payload = buildScenePayload(triangle());
  expect(payload.theme.nodes.entity.fill).toBe("#FFFC87");
  expect(payload.theme.nodes.activity.stroke).toBe("#0000FF");
  // `prov:Usage`'s Graphviz-only `red4` stroke must be projected, not left as a raw word.
  expect(payload.theme.relations["prov:Usage"].color).toBe("#8B0000");
  expect(payload.theme.decor.bundleFill).toBe("aliceblue");
});

test("a theme override reaches the baked node colors", () => {
  // `Partial<ProvTheme>` types `nodes` as the FULL record, but the shared mergeTheme merges
  // per-entry at runtime, so a single-entry override is valid behavior; the cast documents
  // that the missing kinds intentionally fall back to the base theme.
  const override = {
    nodes: { entity: { shape: "oval", style: "filled", fillcolor: "#123456" } },
  } as Partial<ProvTheme>;
  const payload = buildScenePayload(triangle(), { theme: override });
  const entity = payload.nodes.find((n) => n.kind === "entity");
  expect(entity?.fill).toBe("#123456");
  expect(payload.theme.nodes.entity.fill).toBe("#123456");
});

test("InteractiveRenderer implements the Renderer contract (format html, sync string)", () => {
  const renderer = new InteractiveRenderer();
  expect(renderer.format).toBe("html");
  const out = renderer.render(triangle());
  expect(typeof out).toBe("string");
  expect(out).toBe(renderInteractiveHtml(triangle()));
});

test("geometry is rounded to 2 decimals in the payload", () => {
  const payload = buildScenePayload(triangle());
  for (const node of payload.nodes) {
    for (const v of [node.box.x, node.box.y, node.box.width, node.box.height]) {
      expect(Math.round(v * 100) / 100).toBe(v);
    }
  }
});
