# browser-bundle

## Purpose

The prebuilt classic-script artifact in the published `@inflexa-ai/tsprov` dist:
`dist/browser/tsprov.min.js`, a minified IIFE registering one `tsprov` global for pages
that cannot load ES modules (the driving consumer opens on `file://` — the Inflexa report
page, GitHub issue #21). Covers the artifact's file layout, the global's surface, its
self-containment, and the smoke gate that keeps it honest.

## Requirements

### Requirement: Prebuilt classic-script artifact in the published dist
The `@inflexa-ai/tsprov` package SHALL ship a prebuilt browser artifact at
`dist/browser/tsprov.min.js`: a minified classic script (IIFE) accompanied by a source map
`dist/browser/tsprov.min.js.map` that the script references via a trailing
`//# sourceMappingURL=tsprov.min.js.map` comment. The artifact SHALL be self-contained —
it contains no `import` or `export` statement and resolves nothing at load time — and
SHALL be produced by the package `build` script (and therefore by `prepublishOnly` and the
CI build), never committed to the repository.

#### Scenario: Bundle loads as a classic script
- **WHEN** `dist/browser/tsprov.min.js` is executed in a bare JavaScript context with no
  module system and no Node globals (as a `<script src>` on a `file://` page would run it)
- **THEN** it executes without error and registers exactly one new global, `tsprov`

#### Scenario: Bundle is self-contained
- **WHEN** the emitted `tsprov.min.js` text is inspected
- **THEN** it contains no `import` or `export` statement, and the `luxon` dependency is
  inlined rather than referenced

#### Scenario: Source map is linked
- **WHEN** `tsprov.min.js` is inspected
- **THEN** its final lines include `//# sourceMappingURL=tsprov.min.js.map`, and that file
  exists beside it in `dist/browser/`

#### Scenario: Build produces the artifact
- **WHEN** `bun run build` completes in `packages/tsprov`
- **THEN** `dist/browser/tsprov.min.js` and `dist/browser/tsprov.min.js.map` exist

### Requirement: The `tsprov` global exposes the core and graph surface flat
The `tsprov` global SHALL be the flat union of the value exports of the package's two
entry points — the core barrel (`.`) and the graph barrel (`./graph`) — in one namespace.
At minimum the walk surface consumed by the Inflexa report page SHALL be present:
`read`, `ProvGraph`, `provToGraph`, `resolve`, `resolveUnique`, and `lineage`.

#### Scenario: Walk surface is present and live
- **WHEN** the bundle has been loaded and `tsprov.read` deserializes a PROV-JSON document,
  `tsprov.provToGraph` converts it, and `tsprov.lineage` walks the graph
- **THEN** each call succeeds, and the deserialized document `equals()` the document that
  produced the JSON

#### Scenario: Core surface is present
- **WHEN** `tsprov.ProvDocument` is used to author a document and serialize it to
  `"json"` and `"provn"`
- **THEN** both serializations succeed (the serializers' import-time registration
  survived bundling and minification)

### Requirement: Smoke test gates the browser artifact
The package smoke test SHALL load `dist/browser/tsprov.min.js` under classic-script
semantics (a bare `node:vm` context with no module scope and no `require`), assert the
`tsprov` global and its walk surface, and exercise a round-trip plus a graph walk. A
failure SHALL exit non-zero so `prepublishOnly` and CI refuse a broken artifact.

#### Scenario: Broken bundle blocks publish
- **WHEN** the browser bundle is missing, fails to execute, or lacks any of the six
  walk-surface exports, and `bun run smoke` runs
- **THEN** the smoke script exits non-zero
