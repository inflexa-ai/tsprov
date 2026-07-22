# 00 — Rendering Effort Progress Log

> A running, append-only log for the rendering-packages effort (loop.rendering.md).
> **Each iteration appends a new dated entry at the top** (newest first): build state,
> evals added, measured package sizes, decisions/deviations, the valuation answer, and
> the recommended next stage. The stage ladder and hard rules live in
> `loop.rendering.md`; the design direction is `rendering.research.md`.

---

## Status at a glance

| Stage (ladder order) | Deliverable | State |
|---|---|---|
| 0 — workspace restructure | core → `packages/tsprov`, private workspace root | ✅ **done** (2026-07-22) |
| 1 — `tsprov-render-core` | scene graph + `PROV_THEME` + `Renderer` + eval harness | ✅ **done** (2026-07-22) |
| 2 — `tsprov-render-dot` | DOT emitter + Python-parity goldens | ✅ **done** (2026-07-22) |
| 3 — `tsprov-render-mermaid` | Mermaid emitter + goldens | ⬜ not started |
| 4 — `tsprov-render-svg` | dagre layout + string SVG | ⬜ not started |
| 5 — `tsprov-render-interactive` | self-contained interactive HTML | ⬜ not started |
| 6 — `tsprov-render-graphviz` (stretch) | WASM engine over stage-2 DOT | ⬜ gated on go-ahead |

---

## 2026-07-22 · entry 3 — stage 2: `tsprov-render-dot` + Python-parity goldens

**Build:** bare `bun test` 1177 pass / 1 skip / 0 fail (36 files) · `bun run eval`
60 pass / 0 fail (~3.3 s; golden parity ×13, style conformance ×401, packaging incl.
render-dot tarball) · dual build + `tsc --noEmit` clean · core and render-core
zero-line diff · branch `feat/rendering-workspaces`.

### The change

OPSX change `rendering-stage2-dot-renderer` (archived, untracked). New package
`rendering/tsprov-render-dot` (`@inflexa-ai/tsprov-render-dot` 0.1.0): `DotRenderer`
implements `Renderer<string>`, a pure scene-driven string emitter reproducing
`prov_to_dot`'s structure — styled nodes with `URL`, n-ary blank-node routing,
HTML-TABLE annotation notes on dashed links, bundle clusters, dot.py's counter
scheme. Sole runtime dep: render-core `^0.1.0` (the sibling-dep policy formalized as
a MODIFIED `rendering-evals` spec delta: zero-weight = zero THIRD-PARTY deps).

**Goldens are real Python output**: `uv run --with pydot --with lxml --with rdflib
--with ./reference/prov` (python 3.12.4, pydot 4.0.1, prov 2.1.1) over 13 curated
fixtures (6 hand-authored + 7 corpus picks, rationale README committed). The
structural comparator (`dot-extract.ts`) reconstructs relations across optional
blank nodes and fails loudly on unrecognized statements; D15 exclusions are
count-matched to `scene.skipped`, never fuzzed (exercised by `start1`).

### Measured sizes

render-dot: **1591 B** gzipped+minified (budget 1760). A DOT-rendering consumer
installs tsprov + render-core + render-dot ≈ **3.6 KB** gz of rendering code.

### Decisions / deviations

- **D17**: annotation rows keep scene insertion order (`sorted_attributes` is
  presentation; comparator compares rows as a set).
- **D18** (post-review, code-anchored): no blank node for >2-slot relations whose
  tail slots are all unset — Python splits on slot COUNT (`dot.py:352`) yielding an
  information-free mid-edge dot; we draw the direct edge.
- Design correction applied to the archived artifact: HTML-label escaping mirrors
  `html.escape(s, quote=True)` exactly (the design's "quotes stay literal" was
  wrong; implementation byte-verified against real `prov.dot` output).
- Packaging eval pins the unpublished sibling via consumer `overrides` → tarball
  (the standard pre-publish substitution); revisit after first npm publish.
- Curated set is 13 not 12: `bundle3` dropped (byte-identical to `bundle1`),
  `bundle4` dropped from goldens (see below).

### Known issue for a SEPARATE core change (hard rule 1 — not touched here)

`bundle4` exposed a real tsprov↔Python divergence in `unified()`: tsprov resolves a
bundle's own identifier QName in the DOCUMENT-level namespace
(`http://another.org/bundle1`) where Python uses the bundle-LOCAL namespace
(`http://example.org/bundle1`). Cluster members match; only the bundle's own
URI/label differ. Needs investigation → fix or DEVIATIONS entry in
`packages/tsprov`, as its own justified change.

### Valuation

A consumer can now render any PROV document to Graphviz DOT that a `prov.dot` user
recognizes, pipe it to `dot`/WASM/online viewers, and trust it: the styling is
enforced across all 401 corpus+real docs and the structure is held to actual Python
reference output. Cheapest install: three packages, ~3.6 KB gz, zero third-party
deps.

### Next

Stage 3: `tsprov-render-mermaid` (flowchart emitter, PROV classDefs, subgraph
bundles, hexagon-agent deviation logged) + goldens. The mermaid syntax spot-check
can use the beautiful-mermaid render pass.

---

## 2026-07-22 · entry 2 — stage 1: `tsprov-render-core` + the eval harness

**Build:** bare `bun test` 1146 pass / 1 skip / 0 fail (32 files; the skip is the
gated packaging eval, by design) · `bun run eval` 29 pass / 0 fail (~3 s, packaging
eval installs real tarballs) · core proxy build + render-core dual build green ·
`tsc --noEmit` clean · branch `feat/rendering-workspaces`.

### The change

OPSX change `rendering-stage1-render-core-and-evals` (archived, untracked per loop
rules). New packages:

- `rendering/tsprov-render-core` (`@inflexa-ai/tsprov-render-core` 0.1.0): semantic
  `toRenderScene(doc, opts)` walking the document model with `prov_to_dot`'s
  semantics (unified-with-fallback, sub-bundles, n-ary legs, inferred endpoints,
  observable skips, deterministic `n1…`/`e1…` ids); `PROV_THEME` transcribing
  `dot.py:61-168`; `Renderer` interface. Zero runtime deps; tsprov as peer
  `>=0.5.1 <2` + `workspace:*` dev link. 18 in-package tests incl. the
  resolution guard.
- `rendering/evals` (private): corpus sweep (398 + 3 real-world docs, committed
  `counts.snapshot.json`, double-projection byte-equality), dependency-policy eval
  (auto-covers future `rendering/*` members), packaging eval gated on
  `TSPROV_EVAL_FULL=1` (tarball consumer, single tsprov, cross-boundary
  `instanceof`, bundler+nodenext typecheck), budget eval. Root `eval` script opens
  the gate.

New main specs: `render-scene`, `rendering-evals`. DEVIATIONS: **D15** (observable
skips + no blank nodes vs `dot.py:301-313,354-355` — 30 corpus fixtures affected;
**stage-2 golden comparison must consult D15**), **D16** (document-model walk, not
`tsprov/graph` — corrects `rendering.research.md`; `ProvGraph` flattens bundles and
binarizes relations).

### Measured sizes

render-core: **2047 B** gzipped+minified (budget 2260). Real-world scenes:
provenance 68n/211e, prov-inflexa.2 151n/487e, prov-inflexa.3 86n/300e — all deterministic,
zero skips.

### Decisions / deviations

- Post-review tighten (orchestrator finding, Opus fix): `RenderEdge.relation` /
  `SkippedRelation.relation` are the closed `RelationKind` union, not `string`
  (CLAUDE.md domain-type rule); the widening `relationStyle` helper deleted as dead
  tolerance; the one cast carries its closed-registry invariant comment.
- Accepted implementer judgments: theme carries declared + generic (gray) node-style
  maps (faithful to `dot.py:61-92`, needed for exact reproduction); scene attribute
  order is record-insertion order (`sorted_attributes` is presentation — renderers
  sort); edges carry no `bundleId` (derivable from endpoints); packaging eval uses
  `os.tmpdir()` (committed tests can't hardcode session paths).
- `/simplify` outcome: one finding (the typing tighten above), applied via
  delegation; nothing else — exports all consumed, comments WHY-only.

### Valuation

A consumer can now do `toRenderScene(doc)` → a stable, documented, theme-paired
scene graph — the entire substrate every renderer consumes. Cheapest install:
`@inflexa-ai/tsprov` + `@inflexa-ai/tsprov-render-core` (2 KB gz, zero transitive
deps beyond luxon). The harness now mechanically guards the "never pay twice"
promise for every future package.

### Next

Stage 2: `tsprov-render-dot` + Python-parity goldens (generation script under
`rendering/evals/scripts/`, run once by hand via uv; structural comparison, D15-aware
for the 30 skip-affected fixtures).

---

## 2026-07-22 · entry 1 — stage 0: workspace restructure (core → `packages/tsprov`)

**Build:** `bun test` 1118 pass / 0 fail (24 files, run from the workspace root) ·
build + smoke exit 0 via root proxies · `bun install --frozen-lockfile` green from
wiped `node_modules` · `sync.sh --check` green · branch `feat/rendering-workspaces`.

### The change

OPSX change `rendering-stage0-workspace-restructure` (archived at
`openspec/changes/archive/2026-07-22-rendering-stage0-workspace-restructure/`, kept
out of git per the loop rules). The core package moved content-unchanged (53 source
files, all `git mv` R100) to `packages/tsprov`; the root `package.json` is now a
private workspace root (`"workspaces": ["packages/*", "rendering/*"]`) with proxy
scripts (`bun run --cwd packages/tsprov <script>`, exit-code propagation proven).
Corpus stays at repo-root `reference/`; `bootstrap.mjs` and the two corpus-reading
tests repointed. Release CI touched exactly as sanctioned: two `package.json` reads +
`working-directory: packages/tsprov` on the publish step; `sync.sh` manifest path.
New main spec: `openspec/specs/workspace-layout/spec.md` (5 requirements).

### Proof gates (stage-0 evals — all green)

Pack parity: pre-move vs post-move `bun pm pack` file lists identical (222 files),
`@inflexa-ai/tsprov@0.5.1` unchanged. Workspace-link probe: `workspace:*` from a
throwaway `rendering/` member resolved inside the repo (not Bun's global cache);
probe removed traceless. Suite/build/smoke/frozen-install as above.

### Decisions / deviations

- `README.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE` are duplicated at the root and in
  `packages/tsprov/` — `bun pm pack` does not follow symlinks, and pack parity plus
  GitHub's rendering both need real files. Accepted; `CHANGELOG.md`/`README.md` need
  release-time sync discipline. TODO(robustness) candidate for a later stage: a
  prepack sync check.
- `/simplify` skipped this iteration: the diff introduces no new API surface (config,
  path constants, CI paths, doc fixes only) — nothing for a simplification pass to
  act on.
- Corrections vs the planning docs: the real baseline is **1118** tests (the
  migration log's 1112 was stale); bootstrap's root computation needed `../../..`
  (three levels), not `../..`; CI's bare `bun test` needed no change — it discovers
  member tests from the workspace root.

### Valuation

"What can a consumer do after this iteration that they couldn't before?" — nothing
yet, by design: stage 0 is the sanctioned infra exception (hard rule 4). Its value is
that every subsequent stage can link the core live (`workspace:*`), which the pinned
experiments showed is impossible with the old layout. The published artifact is
provably byte-identical, so consumers lose nothing.

### Next

Stage 1: `tsprov-render-core` (scene graph + `PROV_THEME` + `Renderer` interface) +
the eval harness (fixtures wired; dependency-policy, single-instance, and
resolution-guard evals running). Real-world fixtures move from `inflexa_prov_ref/`
into `rendering/evals/fixtures/real-world/` as part of the harness.

---
