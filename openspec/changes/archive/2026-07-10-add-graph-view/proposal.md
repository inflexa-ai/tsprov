## Why

tsprov has no graph representation of a PROV document: finding "all relations touching
entity X" is an O(n) scan of `_records`, and the Python reference's `prov.graph` module
(`prov_to_graph`/`graph_to_prov`, roadmap milestone M8) has no TS counterpart. The lineage
effort (`docs/research/lineage-direction.md`, motivated by inf-cli #66 / PR #72) needs a
build-once adjacency substrate as its foundation — this change ships that substrate plus
Python converter parity, and nothing else.

## What Changes

- New `./graph` subpath export (`@inflexa-ai/tsprov/graph`): the core barrel
  (`src/index.ts`) is untouched; the core stays unaware of the graph layer.
- A hand-rolled multi-digraph over a PROV document, built from `doc.flattened().unified()`:
  element nodes keyed by `identifier.uri`, one edge per relation (first two formal
  attributes), forward and reverse adjacency, and the **full relation record as edge
  payload** (n-ary data preserved). Zero new dependencies
  (`docs/migration/03-dependency-analysis.md:75-80`).
- `provToGraph(doc)` / `graphToProv(graph)` with Python-parity semantics
  (`reference/prov/src/prov/graph.py:59-113`): relations missing either endpoint are
  skipped; endpoints referenced but never declared become synthetic **inferred nodes**
  carrying a sentinel that `graphToProv` uses to skip them on the way back.
- Deliberate divergence, logged in `DEVIATIONS.md`: Python's converter only sees
  document-level records (bundle contents are invisible, `graph.py:68`); the TS graph builds
  from `flattened().unified()` so bundled records participate.
- No resolve/lineage/query API — that is changes #2–#4 of the direction doc's sequence.

## Capabilities

### New Capabilities
- `graph-view`: the multi-digraph representation of a PROV document — construction,
  node/edge/adjacency access, and lossless conversion to and from `ProvDocument`
  (Python `prov.graph` parity).

### Modified Capabilities

_None — no existing spec's requirements change; the core model surface is untouched._

## Impact

- New source under `src/graph.ts` (or `src/graph/` if the design splits it); new test file(s).
- `package.json` gains the `./graph` subpath export (types + ESM + CJS, same dual-build
  pattern as the root export); `tsconfig.build.json` scope unchanged (src-wide).
- `DEVIATIONS.md` gains the flattened-bundles entry.
- No runtime/peer/dev dependency changes. No changes to existing records, bundle, document,
  or serializer code.
