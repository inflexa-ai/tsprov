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
  type RenderNode,
} from "@inflexa-ai/tsprov-render-core";
import { MermaidRenderer, type MermaidRenderOptions } from "@inflexa-ai/tsprov-render-mermaid";

import { parseMermaid, type MermaidShape, type MermaidModel } from "./mermaid-extract.js";

// The Mermaid eval has two layers, mirroring the DOT eval's golden + corpus split but
// in ONE file (Mermaid has no Python reference, so goldens are OUR reviewed-once
// snapshots, not a foreign oracle):
//   1. Golden byte-compare: each curated fixture, rendered under render-options.json,
//      must equal its committed `.mmd`. Any drift is a red test forcing a reviewed
//      regeneration.
//   2. Corpus conformance: render all 401 documents and assert, at scale, no-throw,
//      double-render determinism, per-line grammar recognition (parseMermaid throws on
//      any unknown form), and that every node's shape/class, every classDef body, and
//      every tinted link's linkStyle match PROV_THEME for its kind/relation.

const CURATED_DIR = `${import.meta.dir}/fixtures/curated`;
const GOLDEN_DIR = `${import.meta.dir}/goldens/mermaid`;
const OPTIONS_PATH = `${CURATED_DIR}/render-options.json`;
const CORPUS_DIR = `${import.meta.dir}/../../reference/prov/src/prov/tests/json`;
const REAL_WORLD_DIR = `${import.meta.dir}/fixtures/real-world`;

const renderer = new MermaidRenderer();

/** Renders and asserts the output is a string (the Mermaid renderer is synchronous). */
function renderString(doc: ProvDocument, options?: MermaidRenderOptions): string {
  const out = renderer.render(doc, options);
  if (typeof out !== "string") throw new Error("Mermaid render must be synchronous");
  return out;
}

type FixtureOptions = SceneOptions & { readonly direction?: MermaidRenderOptions["direction"] };

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
    .filter((name) => name.endsWith(".mmd"))
    .map((name) => name.slice(0, -".mmd".length))
    .sort();
}

// ── Golden byte-compare ────────────────────────────────────────────────────────

test("the curated fixture set matches its committed golden count", () => {
  expect(listGoldens().length).toBe(13);
});

for (const fixture of listGoldens()) {
  test(`mermaid golden: ${fixture}`, async () => {
    const options = (await loadOptions())[fixture] ?? {};
    const golden = await Bun.file(`${GOLDEN_DIR}/${fixture}.mmd`).text();
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

/** The Mermaid shape the theme implies for a node kind (the renderer's shape mapping). */
function expectedShape(kind: NodeKind): MermaidShape {
  switch (kind) {
    case "entity":
    case "unknown":
      return "stadium";
    case "activity":
      return "rect";
    case "agent":
      return "hexagon";
    case "bundle":
      return "subroutine";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** The classDef name the renderer attaches to a node (declared colored, or gray inferred). */
function expectedClassName(node: RenderNode): string {
  const suffix = node.inferred ? "Inferred" : "";
  switch (node.kind) {
    case "entity":
      return node.inferred ? "entityInferred" : "entity";
    case "activity":
      return node.inferred ? "activityInferred" : "activity";
    case "agent":
      return node.inferred ? "agentInferred" : "agent";
    case "bundle":
      return node.inferred ? "bundleInferred" : "bundle";
    case "unknown":
      // Declared-unknown is unreachable; it and inferred-unknown both use unknownInferred.
      return `unknown${suffix === "" ? "Inferred" : suffix}`;
    default: {
      const exhaustive: never = node.kind;
      return exhaustive;
    }
  }
}

/** A node classDef body: `fill` always, `stroke` only where the theme sets a border. */
function nodeClassDefBody(style: NodeStyle): string {
  return style.color === undefined
    ? `fill:${style.fillcolor}`
    : `fill:${style.fillcolor},stroke:${style.color}`;
}

/**
 * A relation/leg tint body, matching the renderer's `tintDecl` — including its
 * `toCssColor` projection of Graphviz-only theme names (e.g. `red4` → `#8B0000`). The
 * eval must apply the SAME projection it holds the emitter to, or the conformance check
 * would compare emitted CSS hex against raw Graphviz names and spuriously fail.
 */
function tintBody(color: string | undefined, fontcolor: string | undefined): string | undefined {
  const parts: string[] = [];
  if (color !== undefined) parts.push(`stroke:${toCssColor(color)}`);
  if (fontcolor !== undefined) parts.push(`color:${toCssColor(fontcolor)}`);
  return parts.length === 0 ? undefined : parts.join(",");
}

const LEG_TINT = "stroke:gray,color:dimgray";

// Every classDef body the theme sanctions, by class name.
const EXPECTED_CLASSDEFS = new Map<string, string>([
  ["entity", nodeClassDefBody(PROV_THEME.nodes.entity)],
  ["activity", nodeClassDefBody(PROV_THEME.nodes.activity)],
  ["agent", nodeClassDefBody(PROV_THEME.nodes.agent)],
  ["bundle", nodeClassDefBody(PROV_THEME.nodes.bundle)],
  ["entityInferred", nodeClassDefBody(PROV_THEME.generic.entity)],
  ["activityInferred", nodeClassDefBody(PROV_THEME.generic.activity)],
  ["agentInferred", nodeClassDefBody(PROV_THEME.generic.agent)],
  ["bundleInferred", nodeClassDefBody(PROV_THEME.generic.bundle)],
  ["unknownInferred", nodeClassDefBody(PROV_THEME.generic.unknown)],
  ["annotation", `stroke:${PROV_THEME.annotation.color},color:${PROV_THEME.annotation.fontcolor}`],
  ["bnode", "fill:gray,stroke:gray"],
]);

// Relation label → tint body (only for relations the theme tints).
const RELATION_TINT_BY_LABEL = new Map<string, string>();
for (const style of Object.values(PROV_THEME.relations)) {
  const tint = tintBody(style.color, style.fontcolor);
  if (tint !== undefined) RELATION_TINT_BY_LABEL.set(style.label, tint);
}

const isN = (id: string): boolean => /^n\d+$/.test(id);
const isB = (id: string): boolean => /^b\d+$/.test(id);
const isAnn = (id: string): boolean => /^ann\d+$/.test(id);

/** Asserts every node, classDef, and link tint in a model matches PROV_THEME for its scene role. */
function assertThemeConformant(key: string, model: MermaidModel, doc: ProvDocument): void {
  const scene = toRenderScene(doc);

  // Nodes: each scene node's emitted shape + class must match its kind + inferred flag.
  for (const node of scene.nodes) {
    const emitted = model.nodes.get(node.id);
    const want = `${key} node ${node.id}: ${expectedShape(node.kind)}/${expectedClassName(node)}`;
    const got =
      emitted === undefined
        ? `${key} node ${node.id}: MISSING`
        : `${key} node ${node.id}: ${emitted.shape}/${emitted.className}`;
    expect(got).toBe(want);
  }
  // Blank + annotation nodes carry the fixed shape/class.
  for (const emitted of model.nodes.values()) {
    if (isB(emitted.id)) {
      expect(`${key} ${emitted.id}: ${emitted.shape}/${emitted.className}`).toBe(
        `${key} ${emitted.id}: circle/bnode`,
      );
    } else if (isAnn(emitted.id)) {
      expect(`${key} ${emitted.id}: ${emitted.shape}/${emitted.className}`).toBe(
        `${key} ${emitted.id}: annotation-rect/annotation`,
      );
    }
  }

  // classDefs: every emitted body matches the theme body for its name.
  for (const [name, body] of model.classDefs) {
    expect(`${key} classDef ${name}: ${body}`).toBe(
      `${key} classDef ${name}: ${EXPECTED_CLASSDEFS.get(name) ?? "UNKNOWN"}`,
    );
  }

  // linkStyles: every index addresses a real link.
  for (const index of model.linkStyles.keys()) {
    expect(`${key} linkStyle ${index} in range: ${index < model.links.length}`).toBe(
      `${key} linkStyle ${index} in range: true`,
    );
  }

  // Each link's tint (present or absent) matches the theme for its classified role.
  for (const link of model.links) {
    const got = model.linkStyles.get(link.index);
    let want: string | undefined;
    let role: string;
    if (link.arrow === "-.-") {
      role = "annotation-link";
      want = undefined; // the dotted form is the styling; no linkStyle
    } else if (link.arrow === "---" && isN(link.source) && isB(link.target) && link.label !== null) {
      role = "first-segment";
      want = RELATION_TINT_BY_LABEL.get(link.label);
    } else if (link.arrow === "-->" && isB(link.source) && link.label === null) {
      role = "second-segment";
      // Emitted immediately after its first segment; the tint must equal that relation's.
      const pred = model.links[link.index - 1];
      want =
        pred !== undefined && pred.arrow === "---" && pred.label !== null
          ? RELATION_TINT_BY_LABEL.get(pred.label)
          : got; // unreachable ordering; accept whatever is present
    } else if (link.arrow === "-->" && isB(link.source) && link.label !== null) {
      role = "leg";
      want = LEG_TINT;
    } else if (link.arrow === "-->" && isN(link.source) && isN(link.target) && link.label !== null) {
      role = "binary";
      want = RELATION_TINT_BY_LABEL.get(link.label);
    } else {
      throw new Error(`${key}: unclassifiable link at ${link.index}: ${JSON.stringify(link)}`);
    }
    expect(`${key} link ${link.index} (${role}) tint: ${got ?? "none"}`).toBe(
      `${key} link ${link.index} (${role}) tint: ${want ?? "none"}`,
    );
  }
}

test("every corpus + real-world fixture renders, is deterministic, grammatical, and theme-conformant", async () => {
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

    // 3. Grammar: parseMermaid throws on any unrecognized line.
    const model = parseMermaid(first);

    // 4. Theme conformance: shapes, classes, classDefs, and link tints.
    assertThemeConformant(fixture.key, model, doc);
  }
});
