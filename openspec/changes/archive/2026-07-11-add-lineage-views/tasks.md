## 1. Views module

- [x] 1.1 `src/graph/views.ts`: `toProvDocument(graph, result, options?)` — emission
  mirroring `graphToProv` restricted to the result (design D2), the `closure:
  "referenced" | "none"` fixpoint over references with `closureAdded` reporting (design
  D3), and the opt-in `annotateFrontier` with the exported `tsprovq` namespace constant
  (design D4)
- [x] 1.2 `toFlatGraph(result)` — JSON-safe projection (kind-discriminated nodes,
  asserted-orientation edges with `prefix:localpart` relation types, truncated marks
  from frontier; design D5)
- [x] 1.3 `lineagePaths(graph, result, target, { from?, limit? })` — simple-path DFS
  over `result.edges` in both orientations with the alternate-symmetry rule, default
  limit 100, explicit `truncated` flag (design D6)
- [x] 1.4 Barrel lines in `src/graph/index.ts`

## 2. Tests

- [x] 2.1 `src/graph/views.test.ts`: every spec scenario — serializable document +
  PROV-JSON equality round-trip + PROV-N serialization, inferred-endpoint dangling,
  n-ary derivation closure vs `"none"`, closure-never-bypasses-depth, frontier
  annotation on request + vocabulary-clean default, direction-independent flat edges,
  truncated-vs-terminal in the projection, diamond double explanation, reversed-
  orientation forward paths, explicit path cap
- [x] 2.2 Non-mutation assertions (graph, its document, and the result unchanged by all
  three views)

## 3. Verification

- [x] 3.1 `tsc --noEmit`, full `bun test`, `bun run build`, `bun run smoke` green; no
  new deps; walk/resolve/substrate/core untouched
