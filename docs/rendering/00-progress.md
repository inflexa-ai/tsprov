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
| 3 — `tsprov-render-mermaid` | Mermaid emitter + goldens | ✅ **done** (2026-07-22) |
| 4 — `tsprov-render-svg` | dagre layout + string SVG | ✅ **done** (2026-07-22) |
| 5 — `tsprov-render-interactive` | self-contained interactive HTML | ✅ **done** (2026-07-22) |
| 6 — `tsprov-render-graphviz` (stretch) | WASM engine over stage-2 DOT | ⬜ gated on go-ahead |

---

## 2026-07-22 · entry 6 — stage 5: `tsprov-render-interactive` (the vision centerpiece)

**Build:** bare `bun test` 1281 pass / 1 skip / 0 fail (47 files) · `bun run eval`
164 pass / 0 fail (~8 s) · dual build + `tsc --noEmit` clean · svg goldens
byte-unchanged through the seam carve-out · branch `feat/rendering-workspaces`.

### The change

OPSX change `rendering-stage5-interactive-html` (archived, untracked).
`renderInteractiveHtml(doc, opts): string` (+ `InteractiveRenderer`, format
"html"): ONE self-contained HTML file — inline CSS + ~860-line vanilla JS client,
dagre-positioned scene embedded as `</script>`-escaped JSON, zero external
resource loads, works from `file://`. Features: pan/zoom (rAF-eased viewBox),
capped animated progressive disclosure (`INITIAL_CAP=40` nearest-hop-first,
`EXPAND_CAP=20` per badge click, whole graph ≤50 nodes), attribute panel, search/
filter with dimming, bundle rects, keyboard access, prefers-color-scheme chrome
over fixed PROV glyph colors. Template authored as real files + committed codegen
with a drift test. Layout comes from render-svg's new `layoutScene` seam
(behavior-neutral by byte-identical svg goldens) — one dagre owner, one layout
implementation. Deps: {render-core, render-svg}; dependency-policy eval now pins
exact per-package sets.

### The verify pass earned its keep (two real fixes)

- **Capped disclosure was a spec correction forced by evidence**: the original
  "focus + 2-hop" rule met prov-inflexa.2's 141-degree super-hub and revealed 145/151
  nodes — the gate's numbers passed while the screenshots showed an illegible
  smear. Spec amended, caps implemented (TS + client mirror with an agreement
  test), gate re-run: 40 initial, +20 per expand, 0 console errors.
- **Dark-mode label bug**: in-glyph labels followed chrome `--fg` → light text on
  fixed light-pastel fills. Now fixed dark ink with the WHY in style.css.

### Measured sizes

interactive: **15,421 B** gz (budget 16,970; template included). render-svg
3,511→3,897 B (seam). prov-inflexa.2 output ≈ 505 KB (~70 KB gz). Browser-gate
evidence: `scratchpad/interactive-gate/gate-0{5,6,7}*.png`.

### Known limitations (named follow-ups, in priority order)

1. **Opening view is still a wide band at hub scale**: the baked full-graph dagre
   layout spreads even the capped 40-node set across the hub's rank span (nearest
   visible neighbor ~5.4k units from focus). Fix requires a layout-level change —
   per-state compact layout with morph animation, or a radial hub layout — a
   change-sized follow-up, not a patch (svg goldens byte-lock the shared layout).
2. Note-box text follows `--fg` over white note fill in dark mode (low contrast).
3. Browser gate ran over `http://localhost` serving the byte-identical file
   (Playwright MCP blocks `file://`); self-containment is separately proven by
   the corpus eval (zero network requests).

### Valuation

A consumer can now emit one HTML file — email it, attach it to a pipeline run,
open it anywhere offline — and get an animated, searchable, inspectable PROV
explorer. Cheapest install: tsprov + core + svg + interactive (≈ 21 KB gz of our
code + dagre's 14 KB); text-tier consumers still pay none of it.

### Next

**The ladder (stages 0–5) is COMPLETE.** Endgame per loop.rendering.md: create
the PR and run `/review` 3–4 times, delegate fixes to Opus 4.8, verify, push.
Stage 6 (graphviz WASM) stays gated on explicit go-ahead.

---

## 2026-07-22 · entry 5 — stage 4: `tsprov-render-svg`

**Build:** bare `bun test` 1241 pass / 1 skip / 0 fail (42 files) · `bun run eval`
124 pass / 0 fail (~5.7 s) · dual build + `tsc --noEmit` clean · all four sibling
packages zero-line diff · branch `feat/rendering-workspaces`.

### The change

OPSX change `rendering-stage4-svg-renderer` (archived, untracked). New package
`rendering/tsprov-render-svg` (0.1.0): `SvgRenderer` — sync dagre layered layout
(node boxes from a documented over-approximating text-metric estimator; no DOM)
into pure string SVG with the REAL reference glyphs (ellipse/rect/**house
polygon**/folded-corner note/point circle — SVG restores what Mermaid could not),
theme fills+strokes, deduped per-color arrowhead markers, D18-consistent routing,
`<title>` tooltips, `<a href>` links, post-hoc bundle bbox rects, finite viewBox,
2-decimal rounding. First sanctioned third-party dep: `@dagrejs/dagre@^3`,
confined to this package; consumer cost measured and documented (~14.1 KB min+gz).
Packaging eval now proves the real consumer story: dagre from the live registry,
unpublished sibling override-pinned, one tsprov, dual typecheck.

### Measured sizes

render-svg (our code): **3511 B** gz (budget 3870). Full family so far ≈ 8.8 KB gz
of our code; the picture tier adds dagre's ~14.1 KB only for those who install it.

### Decisions / deviations

- **D20**: coordinates are dagre's, not Graphviz `dot`'s (pixel parity is the
  stretch stage); bundle rects are post-hoc member bboxes (dagre has no clusters —
  `TODO(extend)` for compound mode).
- Golden-review protocol caught a real emitter bug (nodeless graph →
  `-Infinity` viewBox), fixed in the emitter with a clamp — never in the golden.
- Accepted: fill-only agent/bundle glyphs (faithful — dot.py sets no `color` for
  those kinds); minor edge-label overlap in dense fixtures (layout quality is
  eyeball-scoped by design); 7 DEVIATIONS-register pointers in comments (each with
  inline rationale — DEVIATIONS.md is the permanent CLAUDE.md-mandated register,
  distinct from ephemeral spec citations, and the siblings share the idiom).

### Valuation

A consumer can now get a real, styled, tooltipped, hyperlinked PROV picture from a
server or script with **no external tool** — `new SvgRenderer().render(doc)` into
an `<img>`, a data-URI, or a file. Cheapest install for a picture: tsprov + core +
svg ≈ 5.6 KB of our code + dagre's 14.1 KB — and text-tier users still pay none of
it.

### Next

Stage 5: `tsprov-render-interactive` — the self-contained animated HTML
visualization (progressive disclosure, pan/zoom, attribute panel, search, bundle
grouping; scale target prov-inflexa.2). One browser pass gate per the loop file. This is
the stage the vision statement singled out.

---

## 2026-07-22 · entry 4 — stage 3: `tsprov-render-mermaid`

**Build:** bare `bun test` 1209 pass / 1 skip / 0 fail (39 files) · `bun run eval`
92 pass / 0 fail (~4 s) · dual build + `tsc --noEmit` clean · core, render-core,
render-dot zero-line diff · branch `feat/rendering-workspaces`.

### The change

OPSX change `rendering-stage3-mermaid-renderer` (archived, untracked). New package
`rendering/tsprov-render-mermaid` (0.1.0): `MermaidRenderer` emits a deterministic
flowchart — stadium/rect/hexagon shapes with theme classDefs (referenced-only, so
Mermaid never sees an undefined class), index-aligned `linkStyle` tints,
D18-consistent blank-node routing, gray annotation rects on dotted links, subgraph
bundles, `click … href` node links. Sole dep: render-core. Goldens are
reviewed-once snapshots (no Python reference exists for Mermaid), backstopped by a
401-document corpus pass: no-throw, determinism, per-line grammar check (fails
loudly on unknown forms), and shape/classDef/linkStyle theme conformance.
**Spot-render gate passed**: the primer golden parses and renders through
beautiful-mermaid with correct shapes/structure (the stray "click" box in that
render is a beautiful-mermaid parser gap — `click n1 href … _blank` is documented
Mermaid interaction syntax).

### Measured sizes

render-mermaid: **1660 B** gzipped+minified (budget 1830). Full text-tier install
(tsprov + core + dot + mermaid) ≈ **5.3 KB** gz of rendering code, zero third-party
deps.

### Decisions / deviations

- **D19**: Mermaid shape approximations (hexagon agent — no house shape; circle
  join node; rect note; subroutine inferred-bundle), anchored to the dot.py shapes
  they approximate.
- **Orchestrator override (hard rule 7):** the agent transcribed `red4` (Usage
  stroke) verbatim → inert in browsers. Fixed via delegation: the emitter owns a
  documented Graphviz-X11→CSS projection (`toCssColor`, one entry: `red4` →
  `#8B0000`), the theme stays Graphviz-faithful, the conformance eval compares
  through the same exported helper, 4 golden lines regenerated. Usage edges are
  dark-red in browsers again.
- Accepted judgments: unquoted edge labels (fixed PROV vocabulary only),
  annotation-row control-char collapse (19 corpus fixtures embed `\r\n\t`),
  honest-empty `start1` golden (D15 skip → header-only flowchart), no subgraph
  clicks (unreliable in Mermaid).

### Valuation

A consumer can now paste `new MermaidRenderer().render(doc)` output straight into
GitHub/GitLab/Obsidian markdown and get the PROV visual language with zero tooling
— the highest-reach output tier. Cheapest install for it: tsprov + render-core +
render-mermaid (~3.7 KB gz of rendering code).

### Next

Stage 4: `tsprov-render-svg` — first package with an approved third-party dep
(`@dagrejs/dagre` for layout), string SVG with `<title>` tooltips and bundle
rects; budget expectations shift accordingly (dagre is the consumer's cost only in
this package).

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
