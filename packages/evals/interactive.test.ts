import { test, expect } from "bun:test";
import { readdirSync } from "node:fs";
import { ProvDocument } from "@inflexa-ai/tsprov";
import type { SceneOptions } from "@inflexa-ai/tsprov-render-core";
import {
  renderInteractiveHtml,
  buildScenePayload,
  type InteractiveRenderOptions,
} from "@inflexa-ai/tsprov-render-interactive";
import { shouldRegen } from "./regen-scope.js";

// The interactive eval has two layers, mirroring the svg eval's golden + corpus split:
//   1. Payload goldens: for each curated fixture, the embedded positioned scene (the JSON
//      the client reads) must equal its committed `goldens/interactive/<name>.json`. That
//      is where document-specific behavior lives; a template change does NOT touch these.
//      Plus ONE full-HTML golden (`primer-triangle.html`) covering the template envelope.
//   2. Corpus conformance: render all 401 documents and assert, at scale, no-throw,
//      double-render determinism, self-containment (no external resource loads), and that
//      the embedded payload parses and byte-round-trips through the `<`-escape.
//
// There is no Python reference — this is a novel renderer — so the payload goldens are OUR
// reviewed-once snapshots (see the goldens README), enforced structurally by the corpus
// sweep and behaviorally by the one-time browser gate.

const CURATED_DIR = `${import.meta.dir}/fixtures/curated`;
const GOLDEN_DIR = `${import.meta.dir}/goldens/interactive`;
const OPTIONS_PATH = `${CURATED_DIR}/render-options.json`;
const CORPUS_DIR = `${import.meta.dir}/../../reference/prov/src/prov/tests/json`;
const REAL_WORLD_DIR = `${import.meta.dir}/fixtures/real-world`;

type FixtureOptions = SceneOptions & { readonly direction?: InteractiveRenderOptions["direction"] };

async function loadOptions(): Promise<Record<string, FixtureOptions>> {
  const raw = (await Bun.file(OPTIONS_PATH).json()) as Record<string, FixtureOptions | string>;
  const out: Record<string, FixtureOptions> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("_")) continue;
    out[key] = value as FixtureOptions;
  }
  return out;
}

/** The 13 curated fixture basenames (the same set the svg/mermaid/dot goldens cover). */
function listCurated(): string[] {
  return readdirSync(CURATED_DIR)
    .filter((name) => name.endsWith(".json") && name !== "render-options.json")
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

/** The committed payload-golden basenames — the `<name>.json` files in GOLDEN_DIR. */
function listGoldens(): string[] {
  return readdirSync(GOLDEN_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

/** The canonical golden form of a payload: pretty-printed JSON with a trailing newline. */
function payloadGolden(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Extracts the embedded payload text from an emitted page (between the JSON script tags). */
function extractPayload(html: string): string {
  const match = html.match(/<script type="application\/json" id="prov-scene">([\s\S]*?)<\/script>/);
  if (match === null || match[1] === undefined) throw new Error("no payload script found");
  return match[1];
}

// The tokens that would load an EXTERNAL resource. Anchor `href`s to entity URIs are data
// (optional navigation), not resource loads, and are deliberately allowed — the file stays
// fully functional offline. This is the formalized self-containment interpretation.
const EXTERNAL_TOKENS: readonly RegExp[] = [
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

/** The chrome (shell + style + app), with the JSON data payload removed so its URIs are not scanned. */
function chromeOf(html: string): string {
  return html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, "");
}

// ── Payload goldens ──────────────────────────────────────────────────────────────

test("the committed golden set matches its expected count", () => {
  // Count the GOLDENS, not the fixtures: a fixture added without its golden (or a deleted
  // golden) must turn this red, mirroring the svg/mermaid/dot golden-parity count guards.
  expect(listGoldens().length).toBe(13);
});

for (const fixture of listCurated()) {
  test(`interactive payload golden: ${fixture}`, async () => {
    const options = (await loadOptions())[fixture] ?? {};
    const fixtureText = await Bun.file(`${CURATED_DIR}/${fixture}.json`).text();
    const doc = ProvDocument.deserialize(fixtureText, "json");
    const payload = buildScenePayload(doc, options);
    const goldenPath = `${GOLDEN_DIR}/${fixture}.json`;
    // Only a scoped regen writes the golden. Outside regen a MISSING golden is a red test —
    // the byte-compare below reads a nonexistent file and throws — never a silent self-heal.
    if (shouldRegen("interactive")) {
      await Bun.write(goldenPath, payloadGolden(payload));
      return;
    }
    expect(payloadGolden(payload)).toBe(await Bun.file(goldenPath).text());

    // The HTML must embed exactly this payload (parse the un-escaped embed → same bytes).
    const html = renderInteractiveHtml(doc, options);
    const embedded = extractPayload(html).replace(/\\u003c/g, "<");
    expect(JSON.stringify(JSON.parse(embedded))).toBe(JSON.stringify(payload));
  });
}

test("full-HTML golden: primer-triangle", async () => {
  const options = (await loadOptions())["primer-triangle"] ?? {};
  const doc = ProvDocument.deserialize(
    await Bun.file(`${CURATED_DIR}/primer-triangle.json`).text(),
    "json",
  );
  const html = renderInteractiveHtml(doc, options);
  const goldenPath = `${GOLDEN_DIR}/primer-triangle.html`;
  // Only a scoped regen writes the golden; outside regen a missing golden is a red test.
  if (shouldRegen("interactive")) {
    await Bun.write(goldenPath, html);
    return;
  }
  expect(html).toBe(await Bun.file(goldenPath).text());
});

// ── Corpus conformance ───────────────────────────────────────────────────────────

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

test("every corpus + real-world fixture renders deterministically, self-contained, round-tripping", async () => {
  const fixtures = listCorpus();
  // Guard against a missing corpus (un-bootstrapped checkout) silently passing.
  expect(fixtures.length).toBeGreaterThanOrEqual(398 + 3);

  for (const fixture of fixtures) {
    const text = await Bun.file(fixture.path).text();
    const doc = ProvDocument.deserialize(text, "json");

    // 1. No throw + 2. determinism (byte-identical double render).
    // Default options are the reference posture (no useLabels, direction BT, no theme
    // override): this breadth sweep pins the DEFAULT render at corpus scale; the option
    // axes are covered by the in-package unit tests and the curated golden fixtures.
    const first = renderInteractiveHtml(doc);
    const second = renderInteractiveHtml(doc);
    expect(`${fixture.key} deterministic: ${first === second}`).toBe(`${fixture.key} deterministic: true`);

    // 3. Self-containment: the chrome loads no external resource.
    const chrome = chromeOf(first);
    for (const token of EXTERNAL_TOKENS) {
      expect(`${fixture.key} external ${token}: ${token.test(chrome)}`).toBe(
        `${fixture.key} external ${token}: false`,
      );
    }

    // 4. The embedded payload parses and byte-round-trips (canonical JSON in, canonical out),
    //    AND equals the payload the emitter built directly — the full escape round-trip. The
    //    embed sits on its own line inside the script block, so trim the shell's surrounding
    //    whitespace before the byte-exact canonical comparison.
    const embedded = extractPayload(first).trim();
    expect(`${fixture.key} raw </script in payload: ${/<\/script/i.test(embedded)}`).toBe(
      `${fixture.key} raw </script in payload: false`,
    );
    const unescaped = embedded.replace(/\\u003c/g, "<");
    const parsed = JSON.parse(unescaped);
    expect(`${fixture.key} canonical: ${JSON.stringify(parsed) === unescaped}`).toBe(
      `${fixture.key} canonical: true`,
    );
    expect(`${fixture.key} matches input payload: ${JSON.stringify(parsed) === JSON.stringify(buildScenePayload(doc))}`).toBe(
      `${fixture.key} matches input payload: true`,
    );
  }
});
