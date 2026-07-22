import { test, expect } from "bun:test";
import { ProvDocument, ns } from "@inflexa-ai/tsprov";
import { safeLinkUri } from "@inflexa-ai/tsprov-render-core";
import { DotRenderer } from "@inflexa-ai/tsprov-render-dot";
import { MermaidRenderer } from "@inflexa-ai/tsprov-render-mermaid";
import { SvgRenderer } from "@inflexa-ai/tsprov-render-svg";
import { renderInteractiveHtml, buildScenePayload } from "@inflexa-ai/tsprov-render-interactive";

// Adversarial link-scheme eval — the security counterpart to the golden suites.
//
// A PROV identifier URI is `namespace.uri + localpart`, both halves attacker-influenceable,
// and every renderer turns it into a live link sink: the SVG `<a href>`, Mermaid's `click …
// href`, DOT's `URL=`/HTML-`TABLE` `href` (live once Graphviz rasterizes to SVG), and the
// interactive panel/attribute anchors. A `javascript:`/`data:` URI in any of those executes
// when the emitted single file is opened from disk, so every renderer routes its links through
// render-core's `safeLinkUri` allowlist. This fixture is HOSTILE ON PURPOSE and lives INLINE,
// deliberately OUTSIDE the curated golden set — no golden ever contains a hostile scheme, so a
// reviewed golden regeneration can never silently bless one. Each renderer is asserted to drop
// the hostile link while keeping a same-document SAFE link, proving the gate filters by scheme
// rather than wholesale.

/**
 * A document whose only element node carries a `javascript:` identifier URI and one attribute
 * whose VALUE is likewise a `javascript:` identifier — exercising both the node link and the
 * attribute-value link. The attribute NAME sits in a safe `http` namespace so its link must
 * survive, demonstrating that filtering keys on scheme, not on blanket removal.
 */
function hostileDoc(): ProvDocument {
  const js = ns("js", "javascript:alert(1)//");
  const safe = ns("ex", "http://example.org/");
  const doc = new ProvDocument();
  doc.addNamespace(js.prefix, js.uri);
  doc.addNamespace(safe.prefix, safe.uri);
  doc.entity(js.qn("evil"), [[safe.qn("ref"), js.qn("payload")]]);
  return doc;
}

test("fixture sanity: the crafted identifier URI really is a javascript: scheme", () => {
  const js = ns("js", "javascript:alert(1)//");
  expect(js.qn("evil").uri).toBe("javascript:alert(1)//evil");
  expect(safeLinkUri(js.qn("evil").uri)).toBeUndefined();
});

test("interactive: no hostile-scheme URI reaches the payload or a live href", () => {
  const doc = hostileDoc();
  const payload = buildScenePayload(doc);

  // The evil node is still present, but carries NO `uri` field — the hostile scheme was
  // stripped at payload assembly, so the shipped page never holds it.
  const evil = payload.nodes.find((n) => n.qualifiedName === "js:evil");
  expect(evil).toBeDefined();
  expect(evil?.uri).toBeUndefined();

  // Every URI the payload DOES carry is one safeLinkUri would return unchanged (i.e. safe).
  for (const node of payload.nodes) {
    if (node.uri !== undefined) expect(safeLinkUri(node.uri)).toBe(node.uri);
    for (const attr of node.attributes) {
      if (attr.valueUri !== undefined) expect(safeLinkUri(attr.valueUri)).toBe(attr.valueUri);
    }
  }

  // The serialized payload carries no `javascript:` scheme anywhere.
  expect(/javascript:/i.test(JSON.stringify(payload))).toBe(false);

  // And the emitted HTML's embedded payload block has no `javascript:` either. (The app
  // script legitimately mentions "javascript:" in a code comment, so scope the check to the
  // JSON payload block rather than the whole document.)
  const html = renderInteractiveHtml(doc);
  const block = html.match(/id="prov-scene">([\s\S]*?)<\/script>/);
  if (block === null || block[1] === undefined) throw new Error("no payload block found");
  expect(/javascript:/i.test(block[1])).toBe(false);
});

test("svg: the hostile node gets no <a> anchor", () => {
  const svg = new SvgRenderer().render(hostileDoc());
  // The one element node has a hostile URI, so the static SVG must contain no anchor at all.
  expect(svg.includes("<a ")).toBe(false);
  expect(/javascript:/i.test(svg)).toBe(false);
});

test("mermaid: the hostile node gets no click line", () => {
  const mmd = new MermaidRenderer().render(hostileDoc());
  expect(mmd.split("\n").some((line) => line.startsWith("click "))).toBe(false);
  expect(/javascript:/i.test(mmd)).toBe(false);
});

test("dot: the hostile node/value get no URL/href, but the safe attribute-name href survives", () => {
  const dot = new DotRenderer().render(hostileDoc());
  // No hostile scheme leaks into the node `URL` or the value cell `href`.
  expect(/javascript:/i.test(dot)).toBe(false);
  expect(dot.includes("URL=")).toBe(false);
  // The attribute NAME is a safe http URI, so its annotation-row href is kept — filtering is
  // by scheme, not a blanket drop of every link.
  expect(dot.includes('href="http://example.org/ref"')).toBe(true);
});
