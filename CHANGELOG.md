# Changelog

All notable changes to `tsprov` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to semantic versioning.

## [Unreleased]

### Not yet included

PROV-XML, PROV-RDF, graph/DOT visualisation, the CLI, and `ProvBundle.update`/`unified` /
`ProvDocument.add_bundle`. See `docs/migration/` for the roadmap and `DEVIATIONS.md` for intentional
divergences from the Python reference.

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
