import { test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { ProvDocument } from "@inflexa-ai/tsprov";
import {
  toRenderScene,
  PROV_THEME,
  toCssColor,
  type SceneOptions,
  type NodeStyle,
  type NodeKind,
} from "@inflexa-ai/tsprov-render-core";
import { SvgRenderer, type SvgRenderOptions } from "@inflexa-ai/tsprov-render-svg";

import { parseSvg, checkWellFormed, type SvgGlyph } from "./svg-extract.js";

// The SVG eval has two layers, mirroring the Mermaid eval's golden + corpus split in ONE
// file (SVG has no Python reference — dagre's layered layout is NOT Graphviz `dot`'s
// coordinates by design — so goldens are OUR reviewed-once snapshots, not a foreign
// oracle):
//   1. Golden byte-compare: each curated fixture, rendered under render-options.json,
//      must equal its committed `.svg`. Any drift — including a dagre version bump that
//      shifts a coordinate — is a red test forcing a reviewed regeneration.
//   2. Corpus conformance: render all 401 documents and assert, at scale, no-throw,
//      double-render determinism, well-formed XML (hand-rolled tag-balance + attribute-
//      quoting check — no parser dependency), absence of external references, and theme
//      conformance (every glyph carries its kind's fill/stroke; every tinted relation's
//      edge carries its stroke; every arrowhead marker is deduped and referenced).

const CURATED_DIR = `${import.meta.dir}/fixtures/curated`;
const GOLDEN_DIR = `${import.meta.dir}/goldens/svg`;
const OPTIONS_PATH = `${CURATED_DIR}/render-options.json`;
const CORPUS_DIR = `${import.meta.dir}/../../reference/prov/src/prov/tests/json`;
const REAL_WORLD_DIR = `${import.meta.dir}/fixtures/real-world`;

const renderer = new SvgRenderer();

/** Renders and asserts the output is a string (the SVG renderer is synchronous). */
function renderString(doc: ProvDocument, options?: SvgRenderOptions): string {
  const out = renderer.render(doc, options);
  if (typeof out !== "string") throw new Error("SVG render must be synchronous");
  return out;
}

type FixtureOptions = SceneOptions & { readonly direction?: SvgRenderOptions["direction"] };

async function loadOptions(): Promise<Record<string, FixtureOptions>> {
  const raw = (await Bun.file(OPTIONS_PATH).json()) as Record<string, FixtureOptions | string>;
  const out: Record<string, FixtureOptions> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    out[key] = value as FixtureOptions;
  }
  return out;
}

function listGoldens(): string[] {
  return readdirSync(GOLDEN_DIR)
    .filter((name) => name.endsWith(".svg"))
    .map((name) => name.slice(0, -".svg".length))
    .sort();
}

// ── Golden byte-compare ────────────────────────────────────────────────────────

test("the curated fixture set matches its committed golden count", () => {
  expect(listGoldens().length).toBe(13);
});

for (const fixture of listGoldens()) {
  test(`svg golden: ${fixture}`, async () => {
    const options = (await loadOptions())[fixture] ?? {};
    const golden = await Bun.file(`${GOLDEN_DIR}/${fixture}.svg`).text();
    const fixtureText = await Bun.file(`${CURATED_DIR}/${fixture}.json`).text();
    const doc = ProvDocument.deserialize(fixtureText, "json");
    expect(renderString(doc, options)).toBe(golden);
  });
}

// ── Corpus conformance ─────────────────────────────────────────────────────────

type Fixture = { readonly key: string; readonly path: string };

function listCorpus(): Fixture[] {
  const corpus = readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name): Fixture => ({ key: name, path: `${CORPUS_DIR}/${name}` }));
  const realWorld = readdirSync(REAL_WORLD_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name): Fixture => ({ key: `real-world/${name}`, path: `${REAL_WORLD_DIR}/${name}` }));
  return [...corpus, ...realWorld];
}

/** The declared or generic {@link NodeStyle} the theme sanctions for a node kind. */
function themeStyle(kind: NodeKind, inferred: boolean): NodeStyle {
  if (inferred) return PROV_THEME.generic[kind];
  switch (kind) {
    case "entity":
    case "activity":
    case "agent":
    case "bundle":
      return PROV_THEME.nodes[kind];
    case "unknown":
      return PROV_THEME.generic.unknown;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** The glyph shape the emitter draws for a node kind (its silhouette). */
function expectedShape(kind: NodeKind): SvgGlyph["shape"] {
  switch (kind) {
    case "entity":
    case "unknown":
      return "ellipse";
    case "activity":
      return "rect";
    case "agent":
      return "polygon";
    case "bundle":
      return "path";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

const VALID_KINDS: ReadonlySet<string> = new Set([
  "entity",
  "activity",
  "agent",
  "bundle",
  "unknown",
]);

/** The marker id the emitter derives from a stroke color (mirrors `svg.ts`'s `markerId`). */
function markerId(color: string): string {
  return `arrow-${color.replace(/[^A-Za-z0-9]/g, "")}`;
}

/** Asserts every glyph, edge tint, bundle fill, and arrowhead marker matches PROV_THEME. */
function assertThemeConformant(key: string, svg: string, doc: ProvDocument): void {
  const scene = toRenderScene(doc);
  const model = parseSvg(svg);

  // 1. One glyph per scene node, each carrying its kind's themed fill + stroke.
  expect(`${key} glyph count: ${model.glyphs.length}`).toBe(
    `${key} glyph count: ${scene.nodes.length}`,
  );
  for (const glyph of model.glyphs) {
    expect(`${key} glyph kind ${glyph.kind} valid: ${VALID_KINDS.has(glyph.kind)}`).toBe(
      `${key} glyph kind ${glyph.kind} valid: true`,
    );
    const kind = glyph.kind as NodeKind;
    const style = themeStyle(kind, glyph.inferred);
    const wantFill = toCssColor(style.fillcolor);
    const wantStroke = style.color === undefined ? null : toCssColor(style.color);
    expect(`${key} ${glyph.kind}${glyph.inferred ? "*" : ""} ${glyph.shape}/${glyph.fill}/${glyph.stroke}`).toBe(
      `${key} ${glyph.kind}${glyph.inferred ? "*" : ""} ${expectedShape(kind)}/${wantFill}/${wantStroke}`,
    );
  }

  // 2. Bundle groups: one per scene bundle that has ≥1 member node, each aliceblue.
  const membersByBundle = new Map<string, number>();
  for (const node of scene.nodes) {
    if (node.bundleId !== undefined) {
      membersByBundle.set(node.bundleId, (membersByBundle.get(node.bundleId) ?? 0) + 1);
    }
  }
  const nonEmptyBundles = scene.bundles.filter((b) => (membersByBundle.get(b.id) ?? 0) > 0).length;
  expect(`${key} bundle rects: ${model.bundleFills.length}`).toBe(
    `${key} bundle rects: ${nonEmptyBundles}`,
  );
  for (const fill of model.bundleFills) {
    expect(`${key} bundle fill: ${fill}`).toBe(
      `${key} bundle fill: ${toCssColor(PROV_THEME.nodes.bundle.fillcolor)}`,
    );
  }

  // 3. Edge strokes: every emitted stroke is theme-sanctioned, and every tinted relation
  //    present contributes its stroke to the output.
  const sanctioned = new Set<string>(["black", "gray"]);
  const tintsPresent = new Set<string>();
  for (const edge of scene.edges) {
    const style = PROV_THEME.relations[edge.relation];
    const line = toCssColor(style.color ?? "black");
    sanctioned.add(line);
    if (style.color !== undefined) tintsPresent.add(line);
  }
  const emittedStrokes = new Set(model.edges.map((e) => e.stroke));
  for (const stroke of emittedStrokes) {
    expect(`${key} edge stroke "${stroke}" sanctioned: ${sanctioned.has(stroke)}`).toBe(
      `${key} edge stroke "${stroke}" sanctioned: true`,
    );
  }
  for (const tint of tintsPresent) {
    expect(`${key} tint "${tint}" present: ${emittedStrokes.has(tint)}`).toBe(
      `${key} tint "${tint}" present: true`,
    );
  }

  // 4. Arrowhead markers: deduped, each id derived from its color, each referenced marker
  //    defined, and each defined marker's color appears on an arrowed edge.
  const markerIds = new Set<string>();
  const arrowedStrokes = new Set(model.edges.filter((e) => e.arrowed).map((e) => e.stroke));
  for (const marker of model.markers) {
    expect(`${key} marker ${marker.id} id matches color: ${marker.id === markerId(marker.fill)}`).toBe(
      `${key} marker ${marker.id} id matches color: true`,
    );
    expect(`${key} marker ${marker.id} unique: ${!markerIds.has(marker.id)}`).toBe(
      `${key} marker ${marker.id} unique: true`,
    );
    markerIds.add(marker.id);
    expect(`${key} marker ${marker.id} color used on an edge: ${arrowedStrokes.has(marker.fill)}`).toBe(
      `${key} marker ${marker.id} color used on an edge: true`,
    );
  }
  for (const ref of model.markerRefs) {
    expect(`${key} marker-ref ${ref} defined: ${markerIds.has(ref)}`).toBe(
      `${key} marker-ref ${ref} defined: true`,
    );
  }
}

test("every corpus + real-world fixture renders, is deterministic, well-formed, and theme-conformant", async () => {
  const fixtures = listCorpus();
  // Guard against a missing corpus (un-bootstrapped checkout) silently passing.
  expect(fixtures.length).toBeGreaterThanOrEqual(398 + 3);

  for (const fixture of fixtures) {
    const text = await Bun.file(fixture.path).text();
    const doc = ProvDocument.deserialize(text, "json");

    // 1. No throw + 2. determinism (byte-identical double render).
    // Default options are the reference posture (no useLabels, direction BT, no theme
    // override): this breadth sweep pins the DEFAULT render at corpus scale; the option
    // axes are covered by the curated golden fixtures and the in-package unit tests.
    const first = renderString(doc);
    const second = renderString(doc);
    expect(`${fixture.key} deterministic: ${first === second}`).toBe(
      `${fixture.key} deterministic: true`,
    );

    // 3. Well-formed XML (hand-rolled — no parser dependency).
    const wfError = checkWellFormed(first);
    expect(`${fixture.key} well-formed: ${wfError ?? "ok"}`).toBe(`${fixture.key} well-formed: ok`);

    const model = parseSvg(first);

    // 4. A finite, 4-number viewBox.
    expect(`${fixture.key} viewBox finite: ${model.viewBox.length === 4 && model.viewBox.every(Number.isFinite)}`).toBe(
      `${fixture.key} viewBox finite: true`,
    );

    // 5. No external references of any kind.
    expect(`${fixture.key} external refs: ${model.hasExternalReference}`).toBe(
      `${fixture.key} external refs: false`,
    );

    // 6. Theme conformance: glyphs, edge tints, bundle fills, arrowhead markers.
    assertThemeConformant(fixture.key, first, doc);
  }
});
