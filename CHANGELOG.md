# Changelog

All notable changes to `tsprov` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to semantic versioning.

## [Unreleased]

The first feature-complete core, ported from the Python `prov` library (v2.1.1).

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

### Not yet included

PROV-XML, PROV-RDF, graph/DOT visualisation, the CLI, and `ProvBundle.update`/`unified` /
`ProvDocument.add_bundle`. See `docs/migration/` for the roadmap and `DEVIATIONS.md` for intentional
divergences from the Python reference.
