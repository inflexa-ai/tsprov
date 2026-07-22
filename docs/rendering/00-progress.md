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
| 1 — `tsprov-render-core` | scene graph + `PROV_THEME` + `Renderer` + eval harness | ⬜ not started |
| 2 — `tsprov-render-dot` | DOT emitter + Python-parity goldens | ⬜ not started |
| 3 — `tsprov-render-mermaid` | Mermaid emitter + goldens | ⬜ not started |
| 4 — `tsprov-render-svg` | dagre layout + string SVG | ⬜ not started |
| 5 — `tsprov-render-interactive` | self-contained interactive HTML | ⬜ not started |
| 6 — `tsprov-render-graphviz` (stretch) | WASM engine over stage-2 DOT | ⬜ gated on go-ahead |

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
