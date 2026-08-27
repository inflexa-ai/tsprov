# Design: Add Browser Bundle

## Context

`@inflexa-ai/tsprov` builds its dist with plain `tsc` twice (ESM via `tsconfig.build.json`,
CJS via `tsconfig.cjs.json`) — no bundler anywhere in the pipeline. The public surface is
split across two deliberate entry points: the core barrel `src/index.ts` (which exports
`read` and the record/document layer) and the graph barrel `src/graph/index.ts` (which
exports `ProvGraph`, `provToGraph`, `resolve`, `resolveUnique`, `lineage`, and the views).
The core barrel is intentionally unaware of the graph layer.

The consumer (Inflexa report page) loads scripts from `file://`, so only a classic
`<script src>` works: no modules, no bare-import resolution, no network. The artifact must
therefore be one self-contained file that registers a global.

Feasibility was spiked against the real source with Bun 1.3.14 before this design was
written; every decision below that cites "verified" was confirmed by that spike.

## Goals / Non-Goals

**Goals:**

- One minified IIFE at `dist/browser/tsprov.min.js` + linked `tsprov.min.js.map`,
  registering `globalThis.tsprov` with the flat union of both barrels' value exports.
- Self-contained: `luxon` inlined, zero imports/exports in the emitted file.
- Produced by the existing `build` script and gated by the existing `smoke` script, so
  CI (`test.yml`, `release.yml`) and `prepublishOnly` cover it with no workflow edits.

**Non-Goals:**

- No UMD/AMD wrapper, no `exports`-map subpath, no separate npm package: the consumer
  copies the file from disk into page assets (the `echarts.common.min.js` pattern), which
  never consults the `exports` map.
- No ES-module browser build (`<script type="module">` cannot load on `file://` — the
  whole reason this artifact exists).
- No `.d.ts` for the global: browser consumers of the global are script-tag users; typed
  consumers use the ESM/CJS entries.
- No bundle-size budget beyond "reasonable" (~116 KB min / ~36 KB gzip, verified); the
  file is staged locally, never fetched over the network.

## Decisions

### D1: Bundle with `bun build` (no new dependency)

Bun is already the repo's toolchain (CLAUDE.md mandates it) and its bundler emits
`--format=iife` with `--minify` and `--sourcemap=linked` directly from the TypeScript
source. Alternatives rejected: esbuild/rollup would add a dependency the migration docs
never sanctioned ("no new dependencies without explicit approval"), for zero extra
capability.

### D2: A dedicated bundler entry in `scripts/`, not `src/`

New file `packages/tsprov/scripts/browser-entry.ts`:

```ts
import * as core from "../src/index.js";
import * as graph from "../src/graph/index.js";
(globalThis as { tsprov?: unknown }).tsprov = { ...core, ...graph };
```

- **Why not `src/`**: both tsc builds compile everything under `src/`; an entry there
  would emit a side-effectful `dist/browser.js` module into the ESM and CJS dists (and a
  `.d.ts`) that assigns a global on import — a footgun for bundler consumers. `scripts/`
  already holds build-adjacent tooling (`bootstrap.mjs`, `smoke.mjs`) and is outside both
  tsconfigs' `include`.
- **Why a flat merge**: the issue asks for one global covering both layers; the two
  barrels share no value-export name (verified against both `index.ts` files), so the
  spread is lossless. The "core barrel stays unaware of the graph layer" invariant is
  untouched — the entry is bundler input, not a package module, and nothing in `src/`
  imports it.
- **Why not `tsprov.graph.*` namespacing**: the consumer's ask (issue #21) names the six
  symbols flat, and flat matches how the Python `prov` reference exposes its surface.

### D3: Invoke via `--outdir` + `--entry-naming`, never `--outfile`

Verified Bun 1.3.14 behavior: `--outfile=dist/browser/tsprov.min.js` combined with
`--sourcemap=linked` writes the output into the *cwd* (dropping the directory part, and
non-deterministically exiting 1). The working invocation is:

```
bun build scripts/browser-entry.ts --format=iife --minify --sourcemap=linked \
  --target=browser --outdir=dist/browser --entry-naming "tsprov.min.[ext]"
```

`--entry-naming "tsprov.min.[ext]"` yields `tsprov.min.js` + `tsprov.min.js.map` with the
`//# sourceMappingURL=` link, both inside `dist/browser/`. This constraint gets a WHY
comment at the invocation site.

### D4: Wire into `build`, gate in `smoke`

`package.json`: `"build:browser": "bun build …"`, appended to
`"build": "… && bun run build:browser"`. Both CI workflows and `prepublishOnly` already
run `bun run build && bun run smoke`, so the artifact is produced and verified everywhere
with no workflow edits. The `clean` script already removes all of `dist/`.

`smoke.mjs` gains a browser section that reads `dist/browser/tsprov.min.js` and runs it in
a **bare `node:vm` context** — no `require`, no module scope, no Node globals injected —
the closest Node approximation of a `file://` classic script. It asserts:
`globalThis.tsprov` exists; the six issue-named exports are present; a serialize → `read`
round-trip holds; `provToGraph` + `lineage` walk a small doc. Alternative rejected: a
real-browser smoke (playwright/puppeteer) adds a heavyweight dependency for what the vm
check already proves (classic-script loadability and a live surface).

### D5: License banner on the minified file

`--banner '/*! @inflexa-ai/tsprov | Apache-2.0 | https://github.com/inflexa-ai/tsprov */'`.
Apache-2.0 redistribution keeps attribution with the artifact; a `/*!` comment is the
convention minifiers and downstream tooling preserve (echarts, luxon do the same). The
banner is static — no version interpolation, which would demand a build script for one
string (the map and package.json already carry the version).

## Risks / Trade-offs

- [Bun bundler behavior shifts across versions (the `--outfile` quirk proves it moves)]
  → the smoke gate runs on every CI build and before every publish, so a regression
  surfaces as a red build, never as a silently broken published artifact.
- [Flat merge breaks if a future graph export reuses a core name] → the merge is
  last-spread-wins (`graph` over `core`); the smoke test pins the load-bearing names.
  A true collision would be caught earlier anyway: both barrels feed one flat namespace
  in every ESM consumer that imports both, so the collision is a design smell on its own.
- [Bundle duplicates code that ESM consumers already have] → accepted: the artifact
  targets script-tag consumers exclusively; dist size grows ~780 KB (map included),
  which npm absorbs trivially.
- [`sideEffects` is not declared, so the bundler keeps everything] → correct today: the
  serializer registry depends on import-time `registerSerializer` side effects, and the
  spike showed the full surface survives. No change needed.

## Migration Plan

Additive only. Existing consumers see a new `dist/browser/` directory in the package and
nothing else. Rollback = delete the script + entry + smoke section. Shipping happens with
the next ordinary release (the version bump is release-process work, not part of this
change); the CHANGELOG Unreleased entry lands here.

## Open Questions

None — the spike closed the two real unknowns (IIFE support on Bun 1.3.14, and the
sourcemap/outfile interaction).
