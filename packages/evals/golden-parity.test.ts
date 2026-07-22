import { test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { ProvDocument } from "@inflexa-ai/tsprov";
import { toRenderScene, type SceneOptions } from "@inflexa-ai/tsprov-render-core";
import { DotRenderer, type DotRenderOptions } from "@inflexa-ai/tsprov-render-dot";

import {
  extractStructure,
  isDangling,
  BNODE_ENDPOINT,
  parseDot,
  type DotStructure,
  type ReconstructedRelation,
  type AnnotationRow,
} from "./dot-extract.js";

// Python-parity golden eval: for each curated fixture, render it through DotRenderer
// and assert its STRUCTURE matches the committed `prov.dot` golden. Matching is
// reconstruction-based (relations, not raw edges) so the two documented scene↔prov.dot
// divergences are absorbed: the optional blank-node join (collapsed) and D15 dangling
// relations (excluded, count-matched to `scene.skipped`). See dot-extract.ts.

const CURATED_DIR = `${import.meta.dir}/fixtures/curated`;
const GOLDEN_DIR = `${import.meta.dir}/goldens/python-dot`;
const OPTIONS_PATH = `${CURATED_DIR}/render-options.json`;

/** Per-fixture render options (camelCase keys mirroring SceneOptions + direction). */
type FixtureOptions = SceneOptions & { readonly direction?: DotRenderOptions["direction"] };

async function loadOptions(): Promise<Record<string, FixtureOptions>> {
  // Our own committed config; the `_comment` key documents the file and is dropped.
  const raw = (await Bun.file(OPTIONS_PATH).json()) as Record<string, FixtureOptions | string>;
  const out: Record<string, FixtureOptions> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    out[key] = value as FixtureOptions;
  }
  return out;
}

/** Canonical, order-independent string for a Map of attributes. */
function canonMap(map: ReadonlyMap<string, string>): string {
  return JSON.stringify([...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/** Canonical string for one annotation row. */
function canonRow(row: AnnotationRow): string {
  return JSON.stringify([row.name.href, row.name.text, row.value.href, row.value.text]);
}

/** Canonical string for a set of annotation rows (order tolerated per the design). */
function canonRows(rows: readonly AnnotationRow[]): string {
  return JSON.stringify(rows.map(canonRow).sort());
}

/** Canonical string for a reconstructed relation. */
function canonRelation(relation: ReconstructedRelation): string {
  return JSON.stringify({
    source: relation.sourceKey,
    target: relation.targetKey,
    label: relation.label,
    tint: canonMap(relation.tint),
    legs: relation.legs
      .map((leg) => [leg.role, leg.targetKey])
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    annotation: canonRows(relation.annotation),
  });
}

/** Sorted multiset of canonical relation strings. */
function relationMultiset(relations: readonly ReconstructedRelation[]): string[] {
  return relations.map(canonRelation).sort();
}

/** The URLs referenced by non-dangling relations, cluster members, and element annotations. */
function liveUrls(struct: DotStructure, liveRelations: readonly ReconstructedRelation[]): Set<string> {
  const urls = new Set<string>();
  for (const relation of liveRelations) {
    if (relation.sourceKey !== BNODE_ENDPOINT) urls.add(relation.sourceKey);
    if (relation.targetKey !== BNODE_ENDPOINT) urls.add(relation.targetKey);
    for (const leg of relation.legs) if (leg.targetKey !== BNODE_ENDPOINT) urls.add(leg.targetKey);
  }
  for (const cluster of struct.clusters) for (const member of cluster.members) urls.add(member);
  for (const annotation of struct.elementAnnotations) urls.add(annotation.targetUrl);
  return urls;
}

function canonNamedNode(node: {
  style: ReadonlyMap<string, string>;
  label: string | null;
}): string {
  return JSON.stringify({ style: canonMap(node.style), label: node.label });
}

function canonCluster(cluster: DotStructure["clusters"][number]): string {
  return JSON.stringify({ url: cluster.url, label: cluster.label, members: [...cluster.members].sort() });
}

function canonElementAnnotation(annotation: DotStructure["elementAnnotations"][number]): string {
  return JSON.stringify({ target: annotation.targetUrl, rows: canonRows(annotation.rows) });
}

function listGoldens(): string[] {
  return readdirSync(GOLDEN_DIR)
    .filter((name) => name.endsWith(".gv"))
    .map((name) => name.slice(0, -".gv".length))
    .sort();
}

const renderer = new DotRenderer();

test("the curated fixture set matches its committed golden count", () => {
  // Guards against a half-generated golden set silently narrowing the eval.
  expect(listGoldens().length).toBe(13);
});

for (const fixture of listGoldens()) {
  test(`golden parity: ${fixture}`, async () => {
    const options = (await loadOptions())[fixture] ?? {};
    const goldenText = await Bun.file(`${GOLDEN_DIR}/${fixture}.gv`).text();
    const fixtureText = await Bun.file(`${CURATED_DIR}/${fixture}.json`).text();
    const doc = ProvDocument.deserialize(fixtureText, "json");

    const scene = toRenderScene(doc, options);
    const rendered = renderer.render(doc, options);
    if (typeof rendered !== "string") throw new Error("DOT render must be synchronous");

    const golden = extractStructure(goldenText);
    const ours = extractStructure(rendered);

    // rankdir.
    expect(ours.rankdir).toBe(golden.rankdir);

    // Relations. Our output never contains a dangling (blank-endpoint) relation — the
    // scene skips those. The golden's dangling relations are exactly D15 and are
    // count-matched to `scene.skipped`; the remaining (live) relations must match ours.
    const goldenLive = golden.relations.filter((r) => !isDangling(r));
    const goldenDangling = golden.relations.filter(isDangling);
    expect(ours.relations.filter(isDangling).length).toBe(0);
    expect(goldenDangling.length).toBe(scene.skipped.length);
    expect(relationMultiset(ours.relations)).toEqual(relationMultiset(goldenLive));

    // Named nodes. Every node we emit must exist in the golden with identical style;
    // any golden node we omit must be D15-attributable — an inferred (gray) endpoint
    // referenced only by dangling relations.
    for (const [url, node] of ours.namedNodes) {
      const goldenNode = golden.namedNodes.get(url);
      expect(`${fixture} golden has node ${url}: ${goldenNode !== undefined}`).toBe(
        `${fixture} golden has node ${url}: true`,
      );
      if (goldenNode !== undefined) {
        expect(canonNamedNode(node)).toBe(canonNamedNode(goldenNode));
      }
    }
    const live = liveUrls(golden, goldenLive);
    for (const [url, node] of golden.namedNodes) {
      if (ours.namedNodes.has(url)) continue;
      // A golden-only node is legitimate only as a D15 dangling endpoint.
      expect(`${fixture} extra golden node ${url} is inferred(gray): ${node.fillcolor}`).toBe(
        `${fixture} extra golden node ${url} is inferred(gray): lightgray`,
      );
      expect(`${fixture} extra golden node ${url} referenced only by dangling: ${!live.has(url)}`).toBe(
        `${fixture} extra golden node ${url} referenced only by dangling: true`,
      );
    }

    // Clusters and element annotations (never dangling — attached to declared elements).
    expect(ours.clusters.map(canonCluster).sort()).toEqual(golden.clusters.map(canonCluster).sort());
    expect(ours.elementAnnotations.map(canonElementAnnotation).sort()).toEqual(
      golden.elementAnnotations.map(canonElementAnnotation).sort(),
    );
  });
}

test("the extractor fails loudly on an unrecognized statement line", () => {
  const malformed = [
    "digraph G {",
    "rankdir=BT;",
    "n1 [label=\"ex:e\", shape=oval];",
    "this is not a valid statement", // no '=', no '[', no '->'
    "}",
  ].join("\n");
  expect(() => parseDot(malformed)).toThrow(/unrecognized DOT statement/);
});

test("the extractor round-trips a well-formed statement without throwing", () => {
  const wellFormed = [
    "digraph G {",
    "rankdir=BT;",
    'charset="utf-8";',
    'n1 [label="ex:e", URL="http://example.org/e", shape=oval, style=filled, fillcolor="#FFFC87", color="#808080"];',
    "}",
  ].join("\n");
  const model = parseDot(wellFormed);
  expect(model.rankdir).toBe("BT");
  expect(model.nodes.size).toBe(1);
});
