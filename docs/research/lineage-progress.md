# Lineage effort — progress tracker

> One row per change in [`lineage-direction.md`](lineage-direction.md)'s sequence; the loop
> updates this file every iteration (newest log entry at top). Shipped work also gets a dated
> entry in `docs/migration/05-progress-log.md` per that file's convention.

## Status at a glance

| # | OPSX change | State |
|---|---|---|
| 1 | `add-graph-view` — MultiDiGraph substrate + `provToGraph`/`graphToProv` parity | ✅ **shipped + archived** (2026-07-10) |
| 2 | `add-record-resolution` — selector stage + injectable matcher | ⬜ not started |
| 3 | `add-lineage-walk` — directional bounded walk over relation profiles | ⬜ not started |
| 4 | `add-lineage-views` — `.document()` closure view, `.graph()`, `paths()` | ⬜ not started |

## Iteration log (newest first)

### 2026-07-10 · iteration 1 — `add-graph-view` shipped

- `src/graph/{graph.ts,index.ts}` + `graph.test.ts` under the new `./graph` subpath
  (ESM+CJS+types; smoke extended; nodenext consumer check green). Core barrel untouched
  (verified: empty diff vs main across all core paths). Zero new dependencies.
- `ProvGraph.of(doc, options?)` builds from `flattened().unified(options)`; string-keyed
  nodes + forward/reverse adjacency; full relation as edge payload; observable skip
  accounting (`missing-endpoint` / `unmapped-attribute`); `inferred` node flag replaces
  Python's `bundle=None` sentinel (DEVIATIONS D13/D14).
- Corpus oracle partition (pinned by assertion): 334 clean round-trips equal to the
  transform, 36 skip-explained, 28 unify-throw (parity) — sum 398, no silent losses.
- Verify pass fixed one spec-vs-code divergence in the spec's favor→code's favor:
  Python's unreachable `prov:bundle → ProvBundle` map entry is deliberately not ported
  (rationale in `graph.ts` and the synced spec).
- Gates: `bun test` 1059 pass / 0 fail (21 files) · `tsc --noEmit` clean · build + smoke
  green. Implementation by Opus 4.8 worker; orchestration/verification by Fable 5.
- **Next:** change 2, `add-record-resolution`.
