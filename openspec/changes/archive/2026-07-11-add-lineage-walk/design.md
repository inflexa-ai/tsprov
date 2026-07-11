## Context

Change #3 of the lineage sequence. Available substrate: `ProvGraph` (uri-keyed nodes,
`outEdges`/`inEdges` adjacency, full relation as edge payload, `graph.document`) and
`resolve`/`resolveUnique` (produce `ProvRecord`s — elements or relations). Direction-doc
constraints in force: D6 honesty (explicit truncation, safety ceiling), D7 string keys,
walk-never-widens (change #4 owns document closure). Prior art anchors: PROV edges point
effect → cause uniformly in the first-two-formal-attributes convention (verified across
all 15 classes, `docs/research/lineage-tsprov-inventory.md` §2); PR #72's walk semantics
(whole-walk visited set, depth markers, 1000-hop ceiling); dbt's asymmetric depth bounds.

## Goals / Non-Goals

**Goals:**
- One BFS core, parameterized by direction/profile/depth, returning a flat, honest result.
- Root flexibility matching what resolution returns.
- The internal shape a fold/visitor, so change #4 views (and future algebras) consume the
  same core without a public algebra API.

**Non-Goals:**
- Views (document/flat-JSON/paths — change #4), PROV-CONSTRAINTS inference,
  `connect(x, y)`, ultimate-source mode, ranking, reachability indexes (`TODO(extend)`
  seam at most), resolution against raw documents.

## Decisions

**D1 — BFS, not DFS; multi-root; whole-walk visited set.** Breadth-first from all roots
simultaneously with one shared visited set: each node expands once, cycles terminate
naturally, and — because BFS reaches every node at its minimum hop distance — PR #72's
DFS artifact ("a depth-cut node must not be marked visited so a shallower path can still
expand it") cannot occur: the first visit IS the shallowest. This is why the depth
semantics stay simple. Per-root trees/paths are change #4 derivations over the returned
edges; the flat walk does not duplicate work per root.

**D2 — Direction is edge orientation; one symmetric exception.** Every relation's
first-two-attribute edge points effect → cause (verified for all 15 classes).
`"backward"` (ancestry) follows `outEdges` (asserted direction); `"forward"`
(descendants) follows `inEdges`; `alternateOf` (`prov:alternate1 ↔ prov:alternate2`) is
symmetric by PROV-DM, so under either direction its edges are traversed from both
endpoints — otherwise `alternateOf(a, b)` would make `b` an "ancestor" of `a` but not
vice versa, which asserts an ordering PROV does not. `"both"` = the union of one backward
and one forward walk sharing the same roots (each with its own visited set and depth
bound) — deliberately NOT the undirected connected component: an undirected walk through
a shared input would pull in every sibling output ("what else did my ancestor produce"),
which is a different question (change #4's `paths`/future `connect` territory).

**D3 — Profiles are fixed class sets; `wasInfluencedBy` is `all`-only; refinement is an
injected predicate.**
- `dataflow`: Generation, Usage, Derivation, Communication, Start, End, Invalidation —
  the event/data edges (what #66 walks, generalized).
- `responsibility`: Attribution, Association, Delegation.
- `structure`: Specialization (hence Mention — subclass, `instanceof` semantics
  documented), Alternate, Membership.
- `all`: every relation class including Influence. `ProvInfluence` belongs to no named
  profile — it is PROV's unspecific superrelation (can relate any element kinds); putting
  it in a semantically-scoped profile would smuggle unknown-kind edges into a walk that
  promised "data flow" or "responsibility". This settles the direction doc's open
  micro-decision.
- Explicit `readonly RecordClass[]` accepted anywhere a profile name is.
- `edgeWhere?: (edge: GraphEdge) => boolean` composes with the profile (AND) — the same
  injection philosophy as resolve's `where` (user decision (d)). Derivation-subtype
  refinement is a documented usage, not an API: filter on
  `edge.relation.getAssertedTypes()` containing `PROV_REVISION` etc. — no bespoke
  `derivationSubtype` option to maintain.

**D4 — Depth is per-direction edge hops; unbounded is a hard ceiling, and every cutoff is
frontier data.** `depth?: number | { back?: number; forward?: number }` (a bare number
applies to whichever directions run — dbt's `3+model+2` maps to
`{ direction: "both", depth: { back: 3, forward: 2 } }`). A hop is one edge traversal.
Unset means unbounded backed by `MAX_WALK_DEPTH = 1000` (PR #72's ceiling: beyond any
real pipeline; prevents pathological chains from walking forever) — hitting it produces
the same explicit frontier as a user bound, reason `"ceiling"` instead of `"depth"`. A
frontier node IS in `nodes` (it was reached) but its onward edges were not traversed —
`frontier: { uri, direction, reason }[]` says exactly where and why the walk stopped.
Nothing truncates silently (direction-doc D6).

**D5 — Roots accept what resolution produces; unresolvable roots are surfaced, not
thrown.** `roots: LineageRoot | readonly LineageRoot[]` with
`LineageRoot = ProvRecord | QualifiedName | string` (string = uri or `prefix:localpart`,
resolved like resolve's `id`). An element/QName/string root seeds its node uri; a
**relation** root seeds the uris of its first two formal-attribute values that are
present (the edge-as-query-subject contract — its lineage is the closure from both
endpoints). A root that resolves to no node in the graph (typo, or an entity whose only
mention was in a skipped relation) lands in `unknownRoots` and the walk proceeds with the
rest — consistent with the resolution stage's outcomes-as-data contract; throwing would
make one bad root destroy an otherwise-valid multi-root query.

**D6 — The result is flat and deduplicated; the core is an internal fold.**
`LineageResult = { roots: string[]; unknownRoots: string[]; nodes: GraphNode[];
edges: GraphEdge[]; frontier: FrontierEntry[] }` — nodes each once (BFS discovery order,
roots first), edges each once (an edge is traversed at most once per direction; the
`"both"` union dedups by identity), everything uri/reference-based with no new record
copies (the walk never widens; materialization is change #4). Internally the BFS is
written as a fold over visit events (node discovered, edge traversed, cutoff) — the
visitor stays module-private (`TODO(extend)`: the semiring/algebra hook from the
direction doc's phase 3 attaches here) so change #4 consumes the same core without a
public API commitment now.

## Risks / Trade-offs

- [`"both"` union may surprise users expecting the undirected component] → documented on
  the option and pinned by a test (shared-input sibling NOT included).
- [Profile membership disputes (e.g. Start/End in dataflow)] → fixed sets are documented
  with rationale; the explicit class list + `edgeWhere` is the escape hatch, so no
  membership choice is load-bearing.
- [Edge dedup across the `"both"` union needs identity, not value] → edges are the
  substrate's `GraphEdge` objects (stable references from `ProvGraph`); a `Set` of
  references suffices — no value-keying needed, documented in code.
- [Ceiling of 1000 could theoretically bite a legitimate mega-chain] → the frontier entry
  carries `reason: "ceiling"`, so the caller can detect and re-run with an explicit
  larger `depth` (the option accepts any number; only *unset* gets the ceiling).

## Migration Plan

Pure addition (`lineage.ts` + barrel lines + tests). Rollback = delete.

## Open Questions

_None — the direction doc's remaining micro-decisions for this change (influence profile
membership, subtype refinement shape) are settled in D3._
