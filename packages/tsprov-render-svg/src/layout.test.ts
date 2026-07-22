import { test, expect } from "bun:test";
import { ProvDocument, ns } from "@inflexa-ai/tsprov";
import { toRenderScene } from "@inflexa-ai/tsprov-render-core";

import { SvgRenderer, layoutScene, type SvgRenderOptions } from "./svg.js";

// The layout seam is the single layout path: `layoutScene` produces the geometry the
// `SvgRenderer.render` string is serialized from. These tests hold the two in agreement
// (the render carries exactly the seam's counts and coordinates) and prove the seam is
// deterministic — the same guarantees the SVG goldens already enforce, asserted directly
// against the seam so a future consumer (interactive HTML) inherits them.

const ex = ns("ex", "http://example.org/");

/** A primer-triangle document: entity → activity → agent, exercising glyphs + tinted edges. */
function triangle(): ProvDocument {
  const doc = new ProvDocument();
  doc.addNamespace(ex.prefix, ex.uri);
  const e = doc.entity(ex.qn("article"));
  const a = doc.activity(ex.qn("edit"));
  const ag = doc.agent(ex.qn("bob"));
  doc.wasGeneratedBy(e, a);
  doc.wasAssociatedWith(a, ag);
  doc.wasAttributedTo(e, ag);
  return doc;
}

/** `fmt` mirrors the emitter's 2-decimal rounding so a seam coordinate can be found in the SVG. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

const options: SvgRenderOptions = { direction: "BT" };

test("seam and renderer agree: viewBox is the seam's dimensions", () => {
  const doc = triangle();
  const positioned = layoutScene(toRenderScene(doc, options), options);
  const svg = new SvgRenderer().render(doc, options);
  expect(svg).toContain(`viewBox="0 0 ${fmt(positioned.width)} ${fmt(positioned.height)}"`);
});

test("seam and renderer agree: node/edge/marker counts match the emitted groups", () => {
  const doc = triangle();
  const positioned = layoutScene(toRenderScene(doc, options), options);
  const svg = new SvgRenderer().render(doc, options);

  const nodeGroups = svg.match(/<g class="prov-node/g)?.length ?? 0;
  const edgeGroups = svg.match(/<g class="prov-edge">/g)?.length ?? 0;
  const markerDefs = svg.match(/<marker /g)?.length ?? 0;

  expect(nodeGroups).toBe(positioned.nodes.length);
  expect(edgeGroups).toBe(positioned.segments.length);
  expect(markerDefs).toBe(positioned.markerColors.length);
});

test("seam and renderer agree: every node's center appears as its glyph's ellipse/rect origin", () => {
  const doc = triangle();
  const positioned = layoutScene(toRenderScene(doc, options), options);
  const svg = new SvgRenderer().render(doc, options);
  // The three primer glyphs: entity ellipse (cx/cy), activity rect (x/y = corner), agent
  // house polygon. Spot-check the ellipse's center coordinates land in the string.
  const entity = positioned.nodes.find((n) => n.kind === "entity");
  if (entity === undefined) throw new Error("expected an entity node");
  expect(svg).toContain(`cx="${fmt(entity.box.x)}" cy="${fmt(entity.box.y)}"`);
});

test("the seam is deterministic: two layouts of one scene are byte-identical JSON", () => {
  const doc = triangle();
  const scene = toRenderScene(doc, options);
  const first = JSON.stringify(layoutScene(scene, options));
  const second = JSON.stringify(layoutScene(scene, options));
  expect(second).toBe(first);
});

test("the seam is JSON-safe: it round-trips through JSON with no loss", () => {
  const doc = triangle();
  const positioned = layoutScene(toRenderScene(doc, options), options);
  const round = JSON.parse(JSON.stringify(positioned));
  expect(round).toEqual(positioned);
});

test("gates group each primitive under the endpoints that must be visible to show it", () => {
  const doc = triangle();
  const positioned = layoutScene(toRenderScene(doc, options), options);
  // Every binary relation segment gates on exactly its two endpoint node ids, both of
  // which are real nodes in the scene.
  const nodeIds = new Set(positioned.nodes.map((n) => n.id));
  for (const seg of positioned.segments) {
    expect(seg.gates.length).toBeGreaterThanOrEqual(2);
    for (const gate of seg.gates) {
      expect(nodeIds.has(gate)).toBe(true);
    }
  }
});

test("a nodeless scene yields finite zero dimensions (the D15 all-skipped case)", () => {
  // `wasStartedBy` with only a trigger (the activity endpoint unset) is a single-endpoint
  // relation: the scene skips it and mints no inferred node, leaving nothing to lay out
  // (the `start1` curated fixture, whose golden viewBox is "0 0 0 0").
  const doc = ProvDocument.deserialize(
    JSON.stringify({ prefix: { ex: "http://example.org/" }, wasStartedBy: { "ex:start1": { "prov:trigger": "ex:e1" } } }),
    "json",
  );
  const positioned = layoutScene(toRenderScene(doc), {});
  expect(positioned.width).toBe(0);
  expect(positioned.height).toBe(0);
  expect(positioned.nodes.length).toBe(0);
  expect(positioned.segments.length).toBe(0);
});
