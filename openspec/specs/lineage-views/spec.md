# lineage-views Specification

## Purpose

The representations over a lineage walk result — materialization as a standalone,
serializable PROV document with a reference-closure policy (`referenced` fixpoint /
`none`) and opt-in `tsprovq` frontier annotation; the JSON-safe flat projection; and
bounded, orientation-labeled path enumeration. Stage 4 (final) of the lineage sequence
(`docs/research/lineage-direction.md`); the document-as-answer decision follows IVOA
ProvSAP's precedent.

## Requirements

### Requirement: A walk result materializes as a standalone PROV document

`toProvDocument(graph, result, options?)` SHALL build a fresh `ProvDocument` containing
every non-inferred visited node's element and every traversed edge's relation (inferred
nodes are never emitted), returning `{ document, closureAdded }`. The inputs (graph,
its document, the result) SHALL NOT be mutated. The output SHALL serialize through the
existing `"json"` and `"provn"` serializers, and its PROV-JSON round-trip
(`deserialize(serialize(document))`) SHALL equal the document.

#### Scenario: A backward walk becomes a serializable document

- **WHEN** a backward walk over `e2 ← a1 ← e1` is materialized with defaults
- **THEN** the document contains e2, a1, e1 and both relations, serializes to PROV-JSON
  and PROV-N, and the PROV-JSON round-trip equals it

#### Scenario: Inferred endpoints stay unasserted

- **WHEN** a walked edge's endpoint was an inferred node
- **THEN** the output document declares no element for it while the relation is present
  (a dangling reference — legal PROV)

### Requirement: The default closure pulls referenced declarations to a fixpoint, reported separately

With `closure: "referenced"` (the default), any identifier referenced by an included
record's formal-attribute values that is declared in `graph.document` (as an element OR
an identified relation — a derivation's generation/usage legs name relation records)
but absent from the output SHALL pull that record's full declaration into the document,
repeated to a fixpoint (references of pulled records are chased; adjacency never is —
pulling an element never pulls other relations touching it). Pulled records SHALL be
listed in `closureAdded`, distinguishing them from walked content. Identifiers declared
nowhere SHALL remain dangling. With `closure: "none"`, no closure runs and
`closureAdded` SHALL be empty.

#### Scenario: An activity-aware derivation pulls its n-ary legs

- **WHEN** the walk traversed only `wasDerivedFrom(e2, e1, activity: a1, generation: g1,
  usage: u1)` where a1, g1, u1 are declared in the document but were not walked, and the
  result is materialized with the default closure
- **THEN** the output additionally contains a1's declaration, the g1 and u1 relation
  records, and the elements THEY reference — all listed in `closureAdded` — and with
  `closure: "none"` the output contains only e2, e1, and the derivation, with the legs
  dangling

#### Scenario: Closure never bypasses the depth bound

- **WHEN** a depth-bounded walk stopped one hop short of an ancestor chain and the
  result is materialized with the default closure
- **THEN** the beyond-frontier chain is NOT pulled in (closure chases references of
  included records, not the frontier node's untraversed edges)

### Requirement: Frontier annotation is opt-in, namespaced, and absent by default

With `annotateFrontier: true`, each frontier node's re-created element SHALL carry a
`tsprovq:truncated` attribute valued `"depth"` or `"ceiling"`, under an exported
query-namespace constant (prefix `tsprovq`) declared on the output document only when
used. With the option unset, the output SHALL contain no `tsprovq` vocabulary and no
namespace declaration for it. The graph's own records SHALL never be annotated.

#### Scenario: Truncation is visible in the serialized document on request

- **WHEN** a depth-1 walk result is materialized with `annotateFrontier: true`
- **THEN** the frontier node's element in the output carries
  `tsprovq:truncated = "depth"` and the document declares the `tsprovq` namespace

#### Scenario: The default document is vocabulary-clean

- **WHEN** the same result is materialized without the option
- **THEN** no record carries a `tsprovq` attribute and the namespace is not declared

### Requirement: The flat graph is a JSON-safe, direction-independent projection

`toFlatGraph(result)` SHALL return plain data
(`{ roots, unknownRoots, nodes, edges, frontier }`): nodes as
`{ uri, kind: "entity" | "activity" | "agent" | "element", inferred, truncated? }`
(`truncated` present exactly for frontier members), edges as `{ from, to, relation }`
with `relation` the PROV type in `prefix:localpart` form and endpoints in asserted
orientation regardless of the walk's direction. `JSON.stringify` SHALL work on it
directly.

#### Scenario: Backward and forward walks project identical edge orientations

- **WHEN** the same chain is walked backward from its end and forward from its start,
  and both results are projected
- **THEN** both projections carry the same `{ from, to, relation }` edges (asserted
  orientation), differing only in roots and reachable subsets

#### Scenario: Truncation and terminals are distinguishable in the projection

- **WHEN** a depth-bounded result with a frontier and an exhausted terminal is projected
- **THEN** the frontier node carries `truncated` and the terminal does not

### Requirement: Path enumeration is result-scoped, oriented, and explicitly bounded

`lineagePaths(graph, result, target, options?)` SHALL enumerate simple paths over
`result.edges` ONLY (never edges the walk excluded), between `from` (default: each
root) and `target` (both accepting the walk's root forms), in each asserted orientation
(from→target labeled `"asserted"`, target→from labeled `"reversed"`), with `alternateOf`
edges crossable from either endpoint. The return `{ paths, truncated }` SHALL cap the
enumeration at `limit` (default 100) and set `truncated: true` when the cap was hit —
a capped enumeration must never present itself as complete.

#### Scenario: A diamond yields both explanations

- **WHEN** e4's backward result contains a diamond (two derivation paths to e1) and
  paths to e1 are requested
- **THEN** two `"asserted"` paths are returned, each a node/edge sequence from e4 to e1,
  and `truncated` is false

#### Scenario: A forward result explains via the reversed orientation

- **WHEN** a forward walk from e1 reached e3 and paths from e1 to e3 are requested
- **THEN** the connection is returned under the `"reversed"` orientation (e3 → e1 in
  asserted direction)

#### Scenario: The cap is explicit

- **WHEN** a result with more simple paths than `limit: 1` connects the endpoints
- **THEN** exactly one path is returned and `truncated` is true
