# Add Browser Bundle

## Why

The Inflexa report page (inflexa-ai/inflexa, change `add-report-lineage`) must walk provenance
in the browser. The page opens on `file://`, where browsers refuse ES modules, so it can load
only a classic script that registers a global. `@inflexa-ai/tsprov@0.5.1` ships ESM
(`dist/index.js`) and CJS (`dist/cjs/`) but no single-file browser artifact
(GitHub issue [#21](https://github.com/inflexa-ai/tsprov/issues/21)).

## What Changes

- Publish one prebuilt browser artifact at `dist/browser/tsprov.min.js` inside the
  `@inflexa-ai/tsprov` package: a minified classic script (IIFE) with a linked source map
  (`tsprov.min.js.map`).
- The script registers a single global, `tsprov`, exposing the flat union of the core barrel
  (`.`) and the graph barrel (`./graph`) value exports — covering at minimum `read`,
  `ProvGraph`, `provToGraph`, `resolve`, `resolveUnique`, and `lineage` (the surface the
  consumer's lineage walk needs). The two barrels have no colliding value-export names
  (verified), so the flat merge is lossless.
- The `luxon` dependency is inlined into the bundle — a classic script cannot resolve bare
  imports.
- The package `build` script gains a `build:browser` step, so the existing CI build/smoke
  pipeline and `prepublishOnly` produce and gate the artifact with no workflow edits.
- The post-build smoke test (`scripts/smoke.mjs`) additionally loads the bundle under
  classic-script semantics (bare `node:vm` context — no module scope, no `require`) and
  exercises the published surface, so a broken bundle refuses to publish.

## Capabilities

### New Capabilities

- `browser-bundle`: the prebuilt classic-script artifact in the published dist — its file
  layout, the `tsprov` global's surface, its self-containment (no imports at runtime), and
  the smoke gate that keeps it honest.

### Modified Capabilities

<!-- None: no existing spec covers the core package's build artifacts, and no existing
     requirement changes. The ESM/CJS entries and the exports map are untouched. -->

## Impact

- `packages/tsprov/package.json`: new `build:browser` script chained into `build`; no
  `exports`-map change (the consumer stages the file from disk, like
  `echarts/dist/echarts.common.min.js`); `files` already ships `dist` wholesale.
- New bundler entry under `packages/tsprov/scripts/` (build tooling, not `src/` — the tsc
  ESM/CJS dists stay free of a side-effectful module).
- `packages/tsprov/scripts/smoke.mjs`: new browser-bundle section.
- `CHANGELOG.md`: Unreleased entry.
- No new dependencies (Bun's built-in bundler does the work), no CI workflow edits, no
  behavior change for existing ESM/CJS consumers.
