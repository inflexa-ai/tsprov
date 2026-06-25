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

try {
  console.log("smoke: validating published artifacts under node…");

  // `import` condition — ESM entry.
  const esm = await import(pathToFileURL(distEsm).href);
  if (typeof esm.ProvDocument !== "function") {
    throw new Error("ESM dist/index.js: ProvDocument export missing or not a constructor");
  }
  roundtrip(esm.ProvDocument, "ESM  dist/index.js");

  // `require` condition — CJS entry (loaded as CJS via dist/cjs/package.json).
  const require = createRequire(import.meta.url);
  const cjs = require(distCjs);
  if (typeof cjs.ProvDocument !== "function") {
    throw new Error("CJS dist/cjs/index.js: ProvDocument export missing or not a constructor");
  }
  roundtrip(cjs.ProvDocument, "CJS  dist/cjs/index.js");

  console.log("smoke: OK — both entry points load and round-trip.");
} catch (err) {
  console.error("smoke: FAILED —", err?.stack ?? err);
  process.exit(1);
}
