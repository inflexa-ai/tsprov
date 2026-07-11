## Context

Change #4, final of the lineage sequence. Available: `ProvGraph` (nodes/edges/document,
`graphToProv` as the emit-records precedent), `lineage` → `LineageResult`
(nodes/edges/frontier/roots/unknownRoots, reference-based). Direction-doc decision D4
binds this change: the walk never widens; the **document view** defaults to reference
closure with an opt-out, closure-added records distinguishable, frontier annotation
opt-in (default off) in a dedicated namespace. Prior-art anchors: ProvSAP returns lineage
as a PROV document; ProvAbs shows validity-preserving subsetting needs deliberate closure
rules; DataHub documents that full path enumeration does not scale.

## Goals / Non-Goals

**Goals:**
- The lineage answer as a standalone, serializable `ProvDocument` (PROV-JSON and PROV-N
  round-trip through the existing serializers).
- A JSON-safe flat projection for scripts (the PR #72 `formatJson` shape, generalized).
- Bounded path explanation between two nodes of a result.

**Non-Goals:**
- No PROV-CONSTRAINTS inference, no `connect(x, y)` (bidirectional search over the full
  graph — a result-scoped path search is not it), no dot, no tree renderer (presentation
  is app-side), no algebra API, no changes to the walk or substrate.

## Decisions

**D1 — Views are free functions over `(graph, result)`, not methods.** Change #3 shipped
`LineageResult` as a plain object; retrofitting a class for `.document()` would churn a
just-shipped API for sugar. Free named functions match the module's idiom
(`resolve`/`lineage`) and the repo's preference for named function declarations. The
direction doc's `result.document()` sketch is explicitly non-binding.

**D2 — Document emission mirrors `graphToProv`, restricted to the result.** Non-inferred
nodes' elements and every traversed edge's relation are re-created into a fresh
`ProvDocument` via `addRecord` (which re-creates foreign records against the new
document — the same mechanism `graphToProv` already relies on). Inferred nodes are never
emitted (not asserted records); an edge whose endpoint node was inferred therefore
dangles — legal PROV, same as `graphToProv`.

**D3 — `closure: "referenced"` is a fixpoint over references, never adjacency.**
Worklist rule: while any record in the output references (via its formal-attribute
QName values) an identifier that is declared in `graph.document` (element OR identified
relation — a derivation's `prov:generation` leg names a *generation relation*, not an
element) and absent from the output, add that record's full declaration; repeat until
stable. References of pulled records are chased too (a pulled generation references its
entity and activity — leaving them dangling would recreate the problem the closure
exists to solve); adjacency is never chased (pulling an element never pulls the *other*
relations touching it), so the walk's depth bound is not bypassed — the closure adds
declarations, not lineage. Termination: the output only grows, bounded by the document's
record count. Identifiers declared nowhere stay dangling (legal PROV — the same
condition Python's inferred-node sentinel handles). `closure: "none"` skips the fixpoint
entirely. The return is `{ document, closureAdded }` where `closureAdded` lists the
pulled records (in pull order) — the direction-doc D4 distinguishability requirement, as
data rather than annotations so the default output contains no non-standard vocabulary.
Multiple same-id declarations cannot arise: `graph.document` is post-`unified()`.

**D4 — Frontier annotation is opt-in and namespaced; default output is vocabulary-clean.**
With `annotateFrontier: true`, each frontier node's re-created element gains
`tsprovq:truncated = "depth" | "ceiling"` (string literal). The namespace is one exported
constant (prefix `tsprovq`, URI `https://tsprov.dev/ns/query#`) declared on the output
document only when used. Annotation happens on the re-created record in the fresh
document — never on the graph's records (the graph and its document are immutable
inputs). Default off: a consumer diffing lineage output against other PROV tooling
should not meet vendor vocabulary unless they asked for it; programmatic consumers
already get `frontier` on the result and `closureAdded` on the return.

**D5 — `toFlatGraph(result)` is a pure JSON-safe projection.** Shape:
`{ roots, unknownRoots, nodes, edges, frontier }` where nodes are
`{ uri, kind: "entity" | "activity" | "agent" | "element", inferred, truncated? }`
(kind via `instanceof` on the node's element — `"element"` covers custom `ProvElement`
subclasses registered by consumers; `truncated` mirrors frontier membership), and edges
are `{ from, to, relation }` with `relation` the relation's PROV type as a
`prefix:localpart` string and from/to in **asserted orientation regardless of walk
direction** (the walk already guarantees this — edges are the graph's own objects; PR
#72's D6 rationale: direction-independent output lets scripts re-derive either walk).
Everything is plain data — `JSON.stringify` works with no replacer. Needs no `graph`
parameter: `result` nodes carry their elements.

**D6 — `lineagePaths(graph, result, target, { from?, limit? })` enumerates simple paths
over the result's edges only, in asserted orientation, both ways between the endpoints.**
The search space is `result.edges` (already direction-scoped and profile-scoped by the
walk), not the full graph — a path explanation must not smuggle in edges the walk
excluded. `target` (and optional `from`, defaulting to every root) accepts the same
forms as a `LineageRoot` string/QName/record and resolves like the walk's roots. Because
a backward result reaches ancestors via asserted-direction paths root→target and a
forward result reaches descendants via asserted-direction paths target→root, the
function enumerates simple directed paths **in each orientation** (from→target and
target→from) and returns both sets labeled by orientation:
`{ paths: { orientation: "asserted" | "reversed", nodes: string[], edges: GraphEdge[] }[],
truncated: boolean }`. DFS with a visited-per-path set (simple paths, cycle-safe);
`limit` (default 100) caps the total; hitting the cap sets `truncated: true` — the
explicit-truncation discipline, because a silently-capped enumeration reads as "these
are all the paths". `alternateOf` edges traverse from either endpoint within a path
(same symmetry rule as the walk).

## Risks / Trade-offs

- [Reference closure pulls a big halo on pathological docs] → it only pulls
  *declarations* reachable through reference chains of already-included records;
  bounded by document size; `closureAdded` makes the halo visible; `"none"` opts out.
- [`tsprovq` URI is invented vocabulary] → opt-in only, single exported constant, and
  the default document is vocabulary-clean; changing the URI later is a one-constant
  change while it remains opt-in.
- [Path enumeration is exponential in diamonds] → simple-path DFS with a hard `limit`
  and an honest `truncated` flag; the search space is the (already bounded) result, not
  the document.
- [`addRecord` re-creation could theoretically fail on exotic attributes] → the corpus
  round-trip in change #1 already exercises `addRecord` re-creation across all 398
  documents (`graphToProv`); the document-view tests add serializer round-trips on top.

## Migration Plan

Pure addition (`views.ts` + barrel lines + tests). Rollback = delete.

## Open Questions

_None — the direction doc's remaining micro-decisions for this change (query-namespace
URI, closure of relation legs) are settled in D3/D4._
