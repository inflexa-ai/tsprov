## Context

The lineage effort's binding direction (`docs/research/lineage-direction.md`) sequences four
changes; this is #1 — the substrate. tsprov stores records as an ordered array plus an
id-map keyed by the record's own `identifier.uri` (`src/bundle.ts:166-168`); there is no
endpoint index. The Python reference ships `prov_to_graph`/`graph_to_prov`
(`reference/prov/src/prov/graph.py:59-113`) as a pure NetworkX conversion: elements become
nodes, each relation's first two formal attributes become an edge carrying the relation
record, relations missing either endpoint are skipped, and endpoints referenced but never
declared become synthetic "inferred" element nodes built with a `bundle=None` sentinel that
`graph_to_prov` uses to skip them (`graph.py:82,103`). Roadmap M8
(`docs/migration/02-migration-roadmap.md:213-222`) plans exactly this under a `tsprov/graph`
subpath with a hand-rolled MultiDiGraph keyed by `identifier.uri`
(`03-dependency-analysis.md:75-80`).

## Goals / Non-Goals

**Goals:**

- A build-once multi-digraph over a PROV document with forward AND reverse adjacency (the
  reverse index is why this substrate exists — Python's NetworkX gave it for free) and the
  full relation record as edge payload.
- `provToGraph`/`graphToProv` with Python-parity conversion semantics, corpus-verified.
- The `./graph` subpath export wired for both module resolutions, core barrel untouched.

**Non-Goals:**

- No resolve/lineage/query/views API (changes #2–#4). No `isReachable` — at most a
  `TODO(extend)` seam comment. No dot/visualization, no dependencies, no changes to core.

## Decisions

**D1 — Layout: `src/graph/` directory with `src/graph/index.ts` as the subpath barrel.**
M8's sketch says `src/graph.ts`, but changes #2–#4 add resolve/lineage/views under the same
subpath; a single file would grow past a thousand lines. The repo rule "no new barrels"
carves out exactly one exception per subpath entry (CLAUDE.md: the package barrel is the
exception; a subpath is a package entry point). Internal modules import each other directly
with `.js` specifiers; only `index.ts` re-exports.

**D2 — Naming: `ProvGraph` class; `provToGraph`/`graphToProv` functions.**
The structure is a snapshot built from a transformed copy of the document, not a live view —
`GraphView` (the direction doc's non-binding sketch name) would imply liveness it doesn't
have. The converter functions keep the Python names in camelCase (`prov_to_graph` →
`provToGraph`) per the naming-inversion deviation already logged for the rest of the port.
`ProvGraph.of(doc, options?)` is the constructor path; `provToGraph(doc)` delegates to it —
one implementation, parity-named entry preserved.

**D3 — Build from `flattened().unified()`; expose the transformed document.**
Python unifies only (`graph.py:68`) and never sees inside bundles (document-level
`get_records`). Building from `doc.flattened().unified()` lets bundled records participate —
an intentional divergence logged in `DEVIATIONS.md`. `unified()` takes the caller's optional
`UnifiedOptions` pass-through (default parity `"throw"`), because consumers with replayed
records already need `"first"`/`"last"` (v0.4.0). The graph keeps a reference to the
transformed document it was built from (`graph.document`) so converters and later changes
(#2–#4) operate on exactly the records the graph indexed — not the caller's original.

**D4 — Nodes keyed by `identifier.uri`; node payload is a discriminated record, not a
null-bundle sentinel.** `ProvRecord`'s constructor requires a `RecordBundle`
(`src/record/record.ts:165-175`), so Python's `bundle=None` sentinel cannot port literally.
Instead: synthetic elements for inferred endpoints are constructed against the graph's
transformed document as the qualified-name resolver — the constructor does NOT register the
record (only `newRecord`/`addRecordInternal` do, `bundle.ts:389-435`), so the document is
not mutated — and the node carries an explicit `inferred: boolean`. `graphToProv` skips
`inferred` nodes (Python's `n.bundle is not None` guard, `graph.py:103`). The flag is
type-system-honest where Python used an out-of-band sentinel.

**D5 — Edge extraction and the inferred-class map are Python-exact.** The edge is the first
two `formalAttributes` entries; either endpoint `undefined` ⇒ relation skipped
(`graph.py:79`). A TS `INFERRED_ELEMENT_CLASS` equivalent maps formal-attribute QName URIs →
element class (`graph.py:36-56`, including the bundle attribute for `mentionOf`); a
first/second attribute absent from the map ⇒ relation skipped, mirroring Python's caught
`KeyError` (`graph.py:85-87`). The map lives inside `src/graph/` (the needed
`PROV_ATTR_*` constants are public; the internal attribute sets stay internal).

**D6 — MultiDiGraph semantics: every relation is its own edge.** Parallel edges between the
same endpoints are all kept, in document order. Adjacency is
`Map<string, Edge[]>` in both directions (`out` keyed by source uri, `in` keyed by target
uri) plus a flat `edges` list and a `nodes` map — plain string-keyed Maps per the
value-equality invariant; never object-keyed.

**D7 — Corpus-driven round-trip oracle, compared against the transform, not the original.**
Python's test (`test_graphs.py:7-19`) round-trips example documents and skips bundled ones,
comparing to the *original* — which passes only because the examples have no duplicate-id
records. There is no TS port of `examples.py`; the repo's oracle infrastructure is the
398-file JSON corpus (`src/serializers/json.test.ts:35-46`). The graph test therefore
round-trips every corpus document and asserts `graphToProv(provToGraph(doc))` equals
`doc.flattened().unified()` (`ProvDocument.equals`, `src/document.ts:224`) — for
non-bundled, duplicate-free documents that is exactly Python's assertion; for the rest it is
the strongest claim the conversion can honestly make (bundle structure is deliberately
flattened per D3, and provToGraph unifies internally). Documents whose relations get skipped
(missing endpoints) are expected to lose those records — the test must account for skips the
same way Python's semantics do (a skipped relation never reaches the graph, so equality
against the transform still holds only when nothing was skipped; assert equality on the
subset where no skip occurred and assert the skip-count invariant on the rest).

## Risks / Trade-offs

- [Corpus files with duplicate ids or skip-triggering relations make blanket equality
  false] → the test partitions: full equality where the conversion is lossless; an explicit
  record-count + skip accounting where it is not. No silent skips (loop rule 6).
- [Synthetic inferred elements hold a reference to the transformed document] → documented on
  the node type; they are never registered, and `graphToProv` never emits them.
- [`flattened()` returns `this` for bundle-less documents (DEVIATIONS D11), so
  `flattened().unified()` shares the original's records pre-unify] → `unified()` always
  produces a fresh document; the graph never mutates what it indexes.
- [Dual-build (ESM+CJS) subpath wiring is easy to get half-right] → the smoke script
  (`scripts/smoke.mjs`) grows a subpath import; both `tsconfig.build.json` (ESM) and
  `tsconfig.cjs.json` cover `src/graph/` already via src-wide includes — verify, don't assume.

## Migration Plan

Pure addition: new `src/graph/` module, new tests, `package.json` exports entry,
`DEVIATIONS.md` entry. No existing file's behavior changes; rollback is deleting the
directory and the exports entry.

## Open Questions

_None blocking — the direction doc's remaining micro-decisions (influence profile
membership, query-namespace URI, one-endpoint relations in the *query index*) belong to
changes #2–#4, not this substrate._
