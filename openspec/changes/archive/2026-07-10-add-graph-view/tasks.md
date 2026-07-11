## 1. Graph module

- [x] 1.1 `src/graph/graph.ts`: `ProvGraph` — node/edge types (node: uri, element,
  `inferred` flag; edge: from-uri, to-uri, relation record), `ProvGraph.of(doc, options?)`
  building from `doc.flattened().unified(options)`, string-keyed forward/reverse adjacency,
  node lookup, node/edge iteration, `graph.document`, skip accounting (design D3, D4, D6)
- [x] 1.2 Inferred-endpoint handling: TS `INFERRED_ELEMENT_CLASS` map (formal-attr uri →
  element class, incl. mentionOf's bundle attr), synthetic unregistered elements resolved
  against the transformed document, skip on missing/unmapped endpoints (design D4, D5)
- [x] 1.3 `provToGraph(doc, options?)` delegating to `ProvGraph.of`; `graphToProv(graph)`
  emitting non-inferred nodes' elements + every edge's relation into a fresh `ProvDocument`
  (design D2; `graph.py:92-113`)
- [x] 1.4 `src/graph/index.ts` subpath barrel (the only re-export file; internal imports
  stay direct with `.js` specifiers)

## 2. Packaging

- [x] 2.1 `package.json`: `./graph` exports entry (types + ESM import + CJS require),
  mirroring the root export's dual-build shape; confirm both build tsconfigs already
  compile `src/graph/`
- [x] 2.2 `scripts/smoke.mjs`: add a subpath import exercising `ProvGraph` under node
  (ESM + CJS paths, per the script's existing pattern)

## 3. Tests (mirror `test_graphs.py` + the spec's scenarios)

- [x] 3.1 `src/graph/graph.test.ts`: unit scenarios — nodes/edges/payloads, bundle
  participation, parallel edges, reverse adjacency, inferred nodes (declared-later,
  never-declared, missing endpoint, unmapped attr), no-mutation of the input document,
  graphToProv skipping inferred nodes
- [x] 3.2 Corpus round-trip oracle: all 398 JSON corpus files —
  `graphToProv(provToGraph(doc)).equals(doc.flattened().unified())` where zero skips;
  skip-accounting assertion otherwise (design D7; no silent losses)

## 4. Bookkeeping

- [x] 4.1 `DEVIATIONS.md`: flattened-bundles divergence entry (Python's converter never
  sees bundle contents, `graph.py:68`; TS builds from `flattened().unified()`) + the
  inferred-flag-replaces-null-bundle-sentinel note
- [x] 4.2 `bun run typecheck` (or `tsc --noEmit`), full `bun test`, `bun run build`,
  `bun run smoke` all green
