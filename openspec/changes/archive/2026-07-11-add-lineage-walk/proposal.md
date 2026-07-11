## Why

The substrate (change #1) and the selector stage (change #2) exist; nothing yet answers
the question the effort is for: *"where did this come from / what came from this?"*
(inf-cli #66). This is change #3 of the lineage sequence
(`docs/research/lineage-direction.md`): the directional, bounded, cycle-safe walk over a
`ProvGraph`, returning a plain result object. Views (PROV document, flat graph, paths)
are change #4.

## What Changes

- `lineage(graph, roots, options?)` in `src/graph/lineage.ts`: a breadth-first walk from
  one or more roots over the graph's edges, honoring:
  - **direction** — `"backward"` (ancestry: follow edges as asserted, effect → cause),
    `"forward"` (descendants: reversed), or `"both"` (ancestors ∪ descendants — two walks
    sharing roots, NOT the undirected component). `alternateOf` is symmetric and traversed
    both ways under every direction.
  - **relation profiles** — `"dataflow"` / `"responsibility"` / `"structure"` / `"all"`
    or an explicit relation-class list, plus an injectable `edgeWhere` predicate
    (asserted-type refinement for derivation subtypes falls out of it).
  - **depth bounds** — a number or `{ back?, forward? }` (dbt's `3+model+2` semantics),
    default unbounded behind a hard safety ceiling; cutoffs surface as an explicit
    frontier, never silently.
- Result: `LineageResult` — visited nodes, traversed edges (each once), the roots as
  resolved, unresolvable roots surfaced, and the truncation frontier with reasons.
- Roots accept elements, relations (seeding from both endpoints), `QualifiedName`s, or
  URI strings — the shapes change #2's resolution produces.
- No document/tree/path materialization (change #4), no inference mode, no `connect()`,
  no ranking (deferred per the direction doc), no new dependencies, core untouched.

## Capabilities

### New Capabilities
- `lineage-walk`: the directional bounded traversal over a `ProvGraph` and its result
  object — root normalization, direction and profile semantics, depth/ceiling handling,
  and honesty guarantees (explicit frontier, surfaced unknowns).

### Modified Capabilities

_None — `graph-view` and `record-resolution` requirements are unchanged._

## Impact

- New `src/graph/lineage.ts` + `src/graph/lineage.test.ts`; barrel lines in
  `src/graph/index.ts`. Nothing else changes.
