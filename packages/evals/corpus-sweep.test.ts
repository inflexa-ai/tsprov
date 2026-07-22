import { test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { ProvDocument } from "@inflexa-ai/tsprov";
import { toRenderScene } from "@inflexa-ai/tsprov-render-core";
import { shouldRegen } from "./regen-scope.js";

// The corpus sweep: project every PROV-JSON fixture the repo ships (the 398-file
// upstream corpus + the 3 committed real-world documents) through `toRenderScene`
// and assert three things at scale: it never throws, its per-file node/edge/bundle/
// skipped counts are snapshot-stable, and a second projection of the same document
// is byte-identical to the first (the determinism guarantee, checked in bulk).

const CORPUS_DIR = `${import.meta.dir}/../../reference/prov/src/prov/tests/json`;
const REAL_WORLD_DIR = `${import.meta.dir}/fixtures/real-world`;
const SNAPSHOT_PATH = `${import.meta.dir}/counts.snapshot.json`;

/** Per-file scene sizes — the committed snapshot's value shape. */
type Counts = {
  readonly nodes: number;
  readonly edges: number;
  readonly bundles: number;
  readonly skipped: number;
};

/** A fixture to sweep: a stable snapshot key and the file to read. */
type Fixture = { readonly key: string; readonly path: string };

function listFixtures(): Fixture[] {
  const corpus = readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name): Fixture => ({ key: name, path: `${CORPUS_DIR}/${name}` }));
  const realWorld = readdirSync(REAL_WORLD_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map(
      (name): Fixture => ({
        key: `real-world/${name}`,
        path: `${REAL_WORLD_DIR}/${name}`,
      }),
    );
  return [...corpus, ...realWorld];
}

/** Projects one fixture twice; asserts byte-equality and returns its counts + first JSON. */
async function projectFixture(
  fixture: Fixture,
): Promise<{ counts: Counts; json: string }> {
  const text = await Bun.file(fixture.path).text();
  const doc = ProvDocument.deserialize(text, "json");
  // Default options are the reference posture (no useLabels, no direction/theme override):
  // this breadth sweep pins the DEFAULT projection at corpus scale; the option axes are
  // covered narrowly by the in-package unit tests and the curated golden fixtures.
  const first = toRenderScene(doc);
  const second = toRenderScene(doc);
  const firstJson = JSON.stringify(first);
  // Determinism: a second projection of the same document must be byte-identical.
  expect(JSON.stringify(second)).toBe(firstJson);
  return {
    counts: {
      nodes: first.nodes.length,
      edges: first.edges.length,
      bundles: first.bundles.length,
      skipped: first.skipped.length,
    },
    json: firstJson,
  };
}

async function loadSnapshot(): Promise<Record<string, Counts> | null> {
  const file = Bun.file(SNAPSHOT_PATH);
  if (!(await file.exists())) return null;
  // Untrusted only in the sense of "generated data"; it is our own committed file.
  return (await file.json()) as Record<string, Counts>;
}

test("every corpus + real-world fixture projects without throwing", async () => {
  const fixtures = listFixtures();
  // Guard against a missing corpus (un-bootstrapped checkout) silently passing.
  expect(fixtures.length).toBeGreaterThanOrEqual(398 + 3);

  const measured: Record<string, Counts> = {};
  for (const fixture of fixtures) {
    const { counts } = await projectFixture(fixture);
    measured[fixture.key] = counts;
  }

  // Regenerate the committed snapshot on demand (`TSPROV_EVAL_REGEN=counts`, or `=all`) or
  // on first run; otherwise assert the measured counts match it exactly — values and key set.
  const snapshot = await loadSnapshot();
  if (snapshot === null || shouldRegen("counts")) {
    const ordered = Object.fromEntries(
      Object.keys(measured)
        .sort()
        .map((k) => [k, measured[k]]),
    );
    await Bun.write(SNAPSHOT_PATH, `${JSON.stringify(ordered, null, 2)}\n`);
    return;
  }

  expect(Object.keys(measured).sort()).toEqual(Object.keys(snapshot).sort());
  for (const [key, counts] of Object.entries(measured)) {
    expect(snapshot[key]).toEqual(counts);
  }
});

test("the largest real-world document (prov-inflexa.2) survives with stable counts", async () => {
  const { counts } = await projectFixture({
    key: "real-world/prov-inflexa.2.json",
    path: `${REAL_WORLD_DIR}/prov-inflexa.2.json`,
  });
  const snapshot = await loadSnapshot();
  if (snapshot === null) return; // first run generates it in the sweep above
  expect(snapshot["real-world/prov-inflexa.2.json"]).toEqual(counts);
});
