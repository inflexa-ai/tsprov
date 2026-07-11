## 1. Walk module

- [x] 1.1 `src/graph/lineage.ts`: option types (`LineageDirection`, `RelationProfile`,
  `LineageOptions` with `direction`/`relations`/`depth`/`edgeWhere`), profile → class-set
  mapping with the Influence-is-all-only rationale in the JSDoc (design D3), root
  normalization (`LineageRoot`; relation seeds first-two endpoints; unresolvable →
  `unknownRoots`; design D5)
- [x] 1.2 The BFS core as an internal fold (node-discovered / edge-traversed / cutoff
  events; module-private visitor with the `TODO(extend)` algebra seam; design D1, D6):
  shared visited set, per-direction depth counting, `MAX_WALK_DEPTH = 1000` ceiling,
  frontier entries `{ uri, direction, reason: "depth" | "ceiling" }` (design D4),
  alternateOf traversed symmetrically under both directions (design D2)
- [x] 1.3 `lineage(graph, roots, options?)` → `LineageResult` (roots / unknownRoots /
  nodes BFS-order / edges deduped by reference incl. across the "both" union / frontier);
  "both" = backward ∪ forward, never undirected (design D2, D6)
- [x] 1.4 Barrel lines in `src/graph/index.ts`

## 2. Tests

- [x] 2.1 `src/graph/lineage.test.ts`: every spec scenario — relation-root seeding,
  unknown-root survival, backward/forward chains, both-vs-undirected sibling exclusion,
  alternateOf symmetry, default-dataflow vs all vs responsibility profiles,
  Influence-only-under-all, edgeWhere revision refinement (via `getAssertedTypes` +
  `PROV_REVISION`), depth-1 frontier, asymmetric both-bounds, terminal-not-frontier,
  self-read cycle termination, diamond dedup, both-union edge dedup
- [x] 2.2 Non-mutation + reference-identity assertions (result nodes/edges are the
  graph's own objects; graph and document unchanged after a walk)

## 3. Verification

- [x] 3.1 `tsc --noEmit`, full `bun test`, `bun run build`, `bun run smoke` green; no new
  deps; substrate (`graph.ts`, `resolve.ts`) and core untouched
