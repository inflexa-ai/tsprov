// Fetch the PROV-JSON conformance corpus that the test suite uses as its oracle.
//
// `src/serializers/json.test.ts` and `src/graph/graph.test.ts` read 398 fixture
// documents from `reference/prov/src/prov/tests/json` — the corpus of the Python
// `prov` library (trungdong/prov), the reference implementation this package is
// ported from.
//
// The corpus is deliberately NOT vendored, and `reference/` is gitignored: a copied
// oracle is a forked oracle. A stale local copy would keep passing while silently
// drifting from the reference it exists to hold us to, which is strictly worse than
// having no copy at all. The cost of that choice is that a fresh clone has no corpus
// and those two suites die with ENOENT — this script is what pays it.
//
// It is idempotent (a no-op once the corpus is there) and is wired to `pretest`, so
// `bun run test` works on a clean checkout. Note that a *bare* `bun test` bypasses
// lifecycle scripts, so CONTRIBUTING.md tells contributors to run this once by hand.
//
// It tracks upstream `master` on purpose. For a port whose entire value is fidelity
// to the reference, a corpus change upstream SHOULD surface as a failing test rather
// than as silent drift. Pin it when a run has to be reproducible:
//
//   TSPROV_PROV_REF=2.3.0 bun run bootstrap
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/trungdong/prov.git";
const REF = process.env.TSPROV_PROV_REF ?? "master";

// The fixture count the oracle suites are written against. Used only to warn: an
// upstream corpus that has grown or shrunk is news, not an error, and the tests
// themselves are the place that fails on it.
const EXPECTED_FIXTURES = 398;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkout = join(root, "reference", "prov");
const corpus = join(checkout, "src", "prov", "tests", "json");

/** How many `.json` fixtures the corpus currently holds; 0 if it is not there at all. */
function corpusSize() {
  if (!existsSync(corpus)) return 0;
  return readdirSync(corpus).filter((name) => name.endsWith(".json")).length;
}

/** Abort with the manual escape hatch, so a failure here never blocks anyone for long. */
function fail(message) {
  console.error(`bootstrap: FAILED — ${message}`);
  console.error(`\nTo do it by hand:\n  git clone --depth 1 ${REPO} reference/prov\n`);
  process.exit(1);
}

const present = corpusSize();
if (present > 0) {
  console.log(`bootstrap: corpus already present — ${present} fixtures under reference/prov`);
  process.exit(0);
}

// A checkout that exists but carries no corpus is a partial clone (an interrupted
// fetch, most likely). `git clone` refuses a non-empty target, so clear it and start
// clean rather than trying to repair a state we cannot characterise.
if (existsSync(checkout)) {
  console.log("bootstrap: reference/prov exists but holds no corpus — re-cloning");
  rmSync(checkout, { recursive: true, force: true });
}

console.log(`bootstrap: cloning ${REPO} @ ${REF} → reference/prov …`);
const clone = spawnSync("git", ["clone", "--depth", "1", "--branch", REF, REPO, checkout], {
  stdio: "inherit",
});

if (clone.error?.code === "ENOENT") fail("`git` is not on PATH.");
if (clone.status !== 0) fail(`git clone exited ${clone.status}.`);

const size = corpusSize();
if (size === 0) {
  fail(`cloned, but found no fixtures at ${corpus} — has the upstream layout moved?`);
}

console.log(`bootstrap: OK — ${size} PROV-JSON fixtures under reference/prov (the test oracle).`);

if (size !== EXPECTED_FIXTURES) {
  console.log(
    `bootstrap: note — the oracle suites are written against ${EXPECTED_FIXTURES} fixtures, ` +
      `and upstream now has ${size}. The reference corpus has moved; the tests will tell you how.`,
  );
}
