// Post-build smoke test: the published artifacts must actually *execute* and
// round-trip under BOTH module systems Node resolves them with.
//
// A type-correct package is not necessarily a runnable one: a bundler tree-shake
// can drop the implementation or the serializers' import-time
// `registerSerializer(...)` side effects, leaving complete `.d.ts` over a bundle
// that throws on import. This script loads the exact files the `package.json`
// `exports` map points at — `dist/index.js` (the `import` condition) and
// `dist/cjs/index.js` (the `require` condition) — and exercises a real
// serialize → deserialize → equals round-trip. It exits non-zero on any failure
// so that `prepublishOnly` (and the CI smoke step) refuse to publish a broken build.
//
// It runs under `node` on purpose: Node's ESM/CJS resolution is stricter than
// Bun's, and it is the runtime our consumers actually use.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distEsm = join(here, "..", "dist", "index.js");
const distCjs = join(here, "..", "dist", "cjs", "index.js");
const distGraphEsm = join(here, "..", "dist", "graph", "index.js");
const distGraphCjs = join(here, "..", "dist", "cjs", "graph", "index.js");

/**
 * Drive a full author → serialize(both formats) → deserialize → equals cycle.
 * `serialize("json")` is the default format and lives or dies on the JSON
 * serializer's import-time `registerSerializer("json", …)` having survived into the
 * build — exactly the side effect a `"sideEffects": false` tree-shake would drop.
 */
function roundtrip(ProvDocument, label) {
  const doc = new ProvDocument();
  doc.addNamespace("ex", "http://example.org/");
  doc.entity("ex:e1", { "ex:foo": "bar" });
  doc.activity("ex:a1");
  const json = doc.serialize("json");
  const provn = doc.serialize("provn");
  if (!json.length || !provn.length) {
    throw new Error(`${label}: empty serialization (json=${json.length} provn=${provn.length})`);
  }
  const back = ProvDocument.deserialize(json, "json");
  if (!back.equals(doc)) throw new Error(`${label}: deserialize → equals round-trip failed`);
  console.log(`  ok  ${label}  (json=${json.length}B, provn=${provn.length}B, round-trip equal)`);
}

/**
 * Drive the `./graph` subpath: the same tree-shake / side-effect risks apply to a
 * second entry point, and the graph module must resolve `../document.js` etc. to
 * the SAME built module instances the root entry uses (else `instanceof` breaks).
 * Builds a doc with the root `ProvDocument`, converts it, and checks the
 * lossless round-trip against the flattened+unified transform.
 */
function graphSmoke(ProvDocument, graph, label) {
  if (typeof graph.provToGraph !== "function" || typeof graph.graphToProv !== "function") {
    throw new Error(`${label}: provToGraph/graphToProv export missing`);
  }
  const doc = new ProvDocument();
  doc.addNamespace("ex", "http://example.org/");
  doc.entity("ex:e1");
  doc.activity("ex:a1");
  doc.wasGeneratedBy("ex:e1", "ex:a1");
  const g = graph.provToGraph(doc);
  if (g.nodes.length !== 2) throw new Error(`${label}: expected 2 nodes, got ${g.nodes.length}`);
  if (g.edges.length !== 1) throw new Error(`${label}: expected 1 edge, got ${g.edges.length}`);
  const back = graph.graphToProv(g);
  if (!back.equals(doc.flattened().unified())) {
    throw new Error(`${label}: graphToProv(provToGraph(doc)) round-trip failed`);
  }
  console.log(`  ok  ${label}  (nodes=${g.nodes.length}, edges=${g.edges.length}, round-trip equal)`);
}

try {
  console.log("smoke: validating published artifacts under node…");

  // `import` condition — ESM entry.
  const esm = await import(pathToFileURL(distEsm).href);
  if (typeof esm.ProvDocument !== "function") {
    throw new Error("ESM dist/index.js: ProvDocument export missing or not a constructor");
  }
  roundtrip(esm.ProvDocument, "ESM  dist/index.js");

  // `./graph` subpath under ESM — the root ESM module supplies `ProvDocument` so
  // the doc and the graph share the same built class instances.
  const esmGraph = await import(pathToFileURL(distGraphEsm).href);
  if (typeof esmGraph.ProvGraph !== "function") {
    throw new Error("ESM dist/graph/index.js: ProvGraph export missing or not a constructor");
  }
  graphSmoke(esm.ProvDocument, esmGraph, "ESM  dist/graph/index.js");

  // `require` condition — CJS entry (loaded as CJS via dist/cjs/package.json).
  const require = createRequire(import.meta.url);
  const cjs = require(distCjs);
  if (typeof cjs.ProvDocument !== "function") {
    throw new Error("CJS dist/cjs/index.js: ProvDocument export missing or not a constructor");
  }
  roundtrip(cjs.ProvDocument, "CJS  dist/cjs/index.js");

  // `./graph` subpath under CJS.
  const cjsGraph = require(distGraphCjs);
  if (typeof cjsGraph.ProvGraph !== "function") {
    throw new Error("CJS dist/cjs/graph/index.js: ProvGraph export missing or not a constructor");
  }
  graphSmoke(cjs.ProvDocument, cjsGraph, "CJS  dist/cjs/graph/index.js");

  console.log("smoke: OK — both entry points (root + graph) load and round-trip.");
} catch (err) {
  console.error("smoke: FAILED —", err?.stack ?? err);
  process.exit(1);
}
