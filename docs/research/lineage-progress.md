# Lineage effort — progress tracker

> One row per change in [`lineage-direction.md`](lineage-direction.md)'s sequence; the loop
> updates this file every iteration (newest log entry at top). Shipped work also gets a dated
> entry in `docs/migration/05-progress-log.md` per that file's convention.

## Status at a glance

| # | OPSX change | State |
|---|---|---|
| 1 | `add-graph-view` — MultiDiGraph substrate + `provToGraph`/`graphToProv` parity | ✅ **shipped + archived** (2026-07-10) |
| 2 | `add-record-resolution` — selector stage + injectable matcher | ✅ **shipped + archived** (2026-07-10) |
| 3 | `add-lineage-walk` — directional bounded walk over relation profiles | ✅ **shipped + archived** (2026-07-11) |
| 4 | `add-lineage-views` — document/flat/paths views | ✅ **shipped + archived** (2026-07-11) |

## Iteration log (newest first)

### 2026-07-11 · iteration 4 — `add-lineage-views` shipped (sequence complete)

- `src/graph/views.ts` (+ tests, + barrel lines): `toProvDocument(graph, result,
  { closure: "referenced" | "none", annotateFrontier })` → `{ document, closureAdded }` —
  the ProvSAP-style answer-as-PROV-document; reference-fixpoint closure pulls n-ary legs
  (derivation's activity/generation/usage and what THEY reference) without ever chasing
  adjacency (depth bounds never bypassed); `closureAdded` carries the re-created output
  records; opt-in `tsprovq:truncated` annotation with lazy namespace declaration (default
  output vocabulary-clean). `toFlatGraph(result)` — JSON-safe, kind-discriminated,
  asserted-orientation projection with truncated-vs-terminal distinguishable.
  `lineagePaths(graph, result, target, { from?, limit? })` — simple-path DFS over the
  result's edges only, asserted/reversed orientation labels, explicit `truncated` cap flag.
- Worker stalled once (0 tool calls) and was resumed via SendMessage; completed fully on
  resume. Verify found no spec-vs-code divergence.
- Gates: `bun test` 1112 pass / 0 fail (24 files) · tsc clean · build + smoke green ·
  walk/resolve/substrate/core untouched.
- **All four changes archived. Next: PR + Opus-run /review passes (loop closing section).**

### 2026-07-11 · iteration 3 — `add-lineage-walk` shipped

- `src/graph/lineage.ts` (+ tests, + barrel lines): `lineage(graph, roots, options?)` —
  multi-root BFS with per-run visited sets; direction backward (effect→cause, default) /
  forward / both (= backward ∪ forward, never the undirected component); `alternateOf`
  traversed symmetrically under any profile that includes it; relation profiles
  dataflow (default) / responsibility / structure / all (Influence is all-only) +
  injectable `edgeWhere` (derivation-subtype refinement via asserted types); depth as
  number or `{ back, forward }` behind `MAX_WALK_DEPTH = 1000` ceiling; frontier entries
  `{ uri, direction, reason: "depth" | "ceiling" }` only when traversable onward edges
  were declined (exhaustion ≠ truncation); flat reference-based `LineageResult` with
  `unknownRoots` surfaced as data. BFS internal fold kept module-private
  (`TODO(extend)` algebra seam).
- Verify fixed the alternateOf spec scenario in the code's favor (profiles gate every
  edge; the scenario now names `relations: "structure"`). Worker deviation accepted:
  `all` profile = `[ProvRelation]` base class (cannot silently drop a class).
- Gates: `bun test` 1100 pass / 0 fail (23 files) · tsc clean · build + smoke green ·
  substrate/core untouched. Implementation by Opus 4.8 worker.
- **Next:** change 4, `add-lineage-views` — then the PR + Opus-run /review passes.

### 2026-07-10 · iteration 2 — `add-record-resolution` shipped

- `src/graph/resolve.ts` (+ tests, + barrel lines): `RecordSelector` (id / idPrefix /
  idSuffix / idIncludes / idMatches / localpart / type / attributes / `where` injection —
  AND-composed; `{}` matches all), `AttributePredicate` (equals/includes/startsWith, any
  value matches) over one exported normalization (`normalizeAttrValue`: QName by uri OR
  display form; Literal lexical value; deliberately not `valueKey`), `resolve` /
  `resolveUnique` returning discriminated unions (matched-all / not-found+10-id sample /
  resolved / ambiguous+candidates) — no query outcome throws, no new deps.
- Resolution runs over `graph.document.getRecords()` (elements AND relations; inferred
  synthetics proven unresolvable). PR #72's path/hash-prefix contract reproduced with
  built-ins in a shape test — the inf-cli adapter needs no library changes.
- Gates: `bun test` 1082 pass / 0 fail (22 files) · tsc clean · build + smoke green ·
  substrate/core diff empty. Implementation by Opus 4.8 worker; verify found no
  spec-vs-code divergence.
- **Next:** change 3, `add-lineage-walk`.

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
