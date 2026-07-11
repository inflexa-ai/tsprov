# Changelog

All notable changes to `tsprov` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to semantic versioning.

## [Unreleased]

### Not yet included

PROV-XML, PROV-RDF, DOT (graph-visualisation) rendering, and the CLI. See `docs/migration/` for
the roadmap and `DEVIATIONS.md` for intentional divergences from the Python reference. Note the
`@inflexa-ai/tsprov/graph` layer (multi-digraph + lineage queries) *did* ship in `0.5.0`; only
DOT/image rendering of that graph remains out of scope.

## [0.5.0] — 2026-07-11

### Added

- **Graph & lineage layer under the `@inflexa-ai/tsprov/graph` subpath.** A new optional entry
  point — the core public surface and its `luxon`-only dependency are unchanged — for querying
  provenance as a graph. Zero new dependencies.
  - **`ProvGraph`** with `provToGraph` / `graphToProv`: a hand-rolled multi-digraph built from
    `document.flattened().unified()`, matching Python `prov.graph` behavior (first-two-formal-
    attributes edges, inferred-endpoint sentinel). Two deliberate divergences: bundled records
    participate as nodes/edges, and the null-bundle sentinel becomes an explicit `inferred` flag
    (`DEVIATIONS.md` D13/D14).
  - **`resolve` / `resolveUnique`**: a composable selector stage (exact QName/URI, localpart/suffix,
    substring/regex, record-class filter, attribute predicates, injectable matcher) that surfaces
    *all* matches with typed matched/ambiguous/not-found results.
  - **`lineage`**: a directional (`backward` / `forward` / `both`), bounded, cycle-safe
    breadth-first walk returning a flat result (nodes, edges, roots, truncation frontier).
  - **Views** — `toProvDocument` (a standalone document under a `referenced` reference-closure
    fixpoint or `none`, with opt-in `tsprovq` frontier annotation), `toFlatGraph` (JSON-safe
    projection), and `lineagePaths` (bounded, orientation-labeled simple-path enumeration).

## [0.4.0] — 2026-07-06

### Added

- **Opt-in single-valued merge for caller-named non-formal attributes.** `UnifiedOptions` now
  accepts `singleValued?: Iterable<QualifiedNameCandidate>` — non-formal attribute names that
  `unified()` resolves under the existing `formalAttributeConflict` policy instead of unioning
  their values into a multi-value. Naming an attribute here makes a later record's value supersede
  (`"last"`) or be discarded (`"first"`), exactly as a single-valued formal attribute already does,
  so a status/outcome attribute re-emitted across a durable-workflow resume keeps only its latest
  value rather than a contradictory union — while an idempotent replay of identical values still
  dedupes. Unresolvable candidates are ignored (that attribute stays multi-valued). Additive and
  backward-compatible; the default merge is byte-identical to before. See commit `97941c7`.

## [0.3.0] — 2026-07-06

### Added

- **Opt-in merge policy for `unified()` formal-attribute conflicts.** `ProvBundle.unified` and
  `ProvDocument.unified` now accept `{ formalAttributeConflict?: "throw" | "first" | "last" }`
  (default `"throw"`). Previously, unifying two same-identifier records that carried different
  values for a single-valued formal attribute (e.g. two `prov:startTime`s on one activity) always
  raised `"Cannot have more than one value for attribute …"`. Consumers whose records can
  legitimately be observed more than once — an event source that replays on crash recovery — can now
  pass `"first"` (keep the earliest-recorded value) or `"last"` (last-write-wins), both ordered by
  record insertion order. The default is unchanged and byte-identical to the Python reference; see
  `DEVIATIONS.md` D12. New public types: `FormalAttributeConflictPolicy` and `UnifiedOptions`.

## [0.1.1] — 2026-06-25

### Fixed

- **The published runtime was non-functional.** `0.1.0` shipped a `bun build` bundle that was
  tree-shaken empty — `import { ProvDocument } from "@inflexa-ai/tsprov"` threw
  `"NamespaceManager" is not declared in this file` at load, even though the `.d.ts` were complete.
  Root cause: `"sideEffects": false` was declared while the serializer modules self-register at
  import time (`registerSerializer(...)`), which let the bundler strip the implementation (and the
  default-format JSON registration) out of the re-export barrel.
- The runtime is now emitted **per-module by `tsc`** (no bundler, no tree-shaking) — a deterministic
  mirror of the per-module `.d.ts` — and `"sideEffects": false` was removed. A post-build smoke test
  (`scripts/smoke.mjs`, run by `prepublishOnly` and CI) loads both the ESM and CJS entry points and
  round-trips a document, so a runtime-broken build can no longer be published.

## [0.1.0] — 2026-06-19

The first feature-complete core, ported from the Python `prov` library (v2.1.1).

> **Note:** the `0.1.0` artifact was non-functional at runtime; use `0.1.1`. See above.

### Added

- **PROV-DM in-memory model**: `Identifier`, `QualifiedName`, `Namespace`, `Literal`; the record
  hierarchy (`ProvRecord` → `ProvElement`/`ProvRelation` → 3 elements + 15 relation classes);
  `NamespaceManager`, `ProvBundle`, `ProvDocument`.
- **Content-based value equality** (`equals()` / canonical `key`) — the core correctness guarantee,
  validated against the full 398-file Python PROV-JSON conformance corpus via a round-trip oracle.
- **Fluent authoring API** on both containers (`doc.wasGeneratedBy(e, a)`) and records
  (`e.wasGeneratedBy(a)`), with the camelCase PROV vocabulary primary and descriptive aliases.
- **Serializers**: PROV-JSON (serialize + deserialize) and PROV-N (serialize; byte-exact vs Python).
- `read()` convenience reader with format auto-detection.
- Sub-bundles, `flattened()`, namespaces, anonymous identifiers.
- Dual ESM + CJS build with `.d.ts`; core dependency: `luxon` only.
