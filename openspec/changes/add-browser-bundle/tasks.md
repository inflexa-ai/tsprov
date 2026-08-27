# Tasks: Add Browser Bundle

## 1. Bundler entry and build wiring

- [ ] 1.1 Create `packages/tsprov/scripts/browser-entry.ts` importing both barrels and
  assigning the flat merge to `globalThis.tsprov`, with WHY comments (scripts/ placement,
  flat-merge losslessness, spread order)
- [ ] 1.2 Add `build:browser` to `packages/tsprov/package.json` using
  `--outdir=dist/browser --entry-naming "tsprov.min.[ext]"` (never `--outfile` — Bun
  1.3.14 sourcemap quirk), with `--format=iife --minify --sourcemap=linked
  --target=browser` and the Apache-2.0 `/*!` banner; chain it into `build`
- [ ] 1.3 Run `bun run build` in `packages/tsprov` and confirm
  `dist/browser/tsprov.min.js` + `tsprov.min.js.map` exist, the file starts with the
  `/*!` license banner (unverified in the spike — drop the banner flag if minify strips
  it), ends with the `sourceMappingURL` link, and contains no `import`/`export` statement

## 2. Smoke gate

- [ ] 2.1 Extend `packages/tsprov/scripts/smoke.mjs` with a browser-bundle section: run
  the file in a bare `node:vm` context, assert `tsprov` is the ONLY global the script
  registered (the spec's "exactly one new global"), assert the six walk-surface
  exports (`read`, `ProvGraph`, `provToGraph`, `resolve`, `resolveUnique`, `lineage`),
  a serialize → `read` round-trip, and a `provToGraph` + `lineage` walk
- [ ] 2.2 Run `bun run smoke` and confirm the new section passes; then verify the failure
  path: temporarily move `dist/browser/tsprov.min.js` aside, assert `bun run smoke`
  exits non-zero, restore the file

## 3. Documentation

- [ ] 3.1 Add a CHANGELOG.md Unreleased "Added" entry for the browser artifact (path,
  global name, consumer loading pattern)
- [ ] 3.2 Check README.md's install/usage section only: if it enumerates the shipped
  dist formats (ESM/CJS), add the browser artifact; otherwise leave it untouched
