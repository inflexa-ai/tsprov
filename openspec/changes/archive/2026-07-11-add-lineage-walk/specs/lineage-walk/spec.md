# lineage-walk Delta Specification

## ADDED Requirements

### Requirement: Roots normalize to node URIs, with unresolvable roots surfaced as data

`lineage(graph, roots, options?)` SHALL accept one root or an array, each a `ProvRecord`,
`QualifiedName`, or string (URI or `prefix:localpart`, resolved against the graph's
document like resolution's `id`). An element root SHALL seed its node URI; a relation
root SHALL seed the URIs of its first two formal-attribute values that are present (an
edge is a legal query subject — its lineage is the closure from both endpoints). A root
that resolves to no node in the graph SHALL be listed in `unknownRoots` while the walk
proceeds with the remaining roots; no query outcome SHALL be thrown.

#### Scenario: A relation root seeds both endpoints

- **WHEN** `lineage(graph, gen)` is called with the `wasGeneratedBy(e1, a1)` record
- **THEN** the walk starts from both e1 and a1, and `roots` contains both URIs

#### Scenario: An unknown root does not destroy a multi-root query

- **WHEN** roots are `["ex:e1", "ex:nope"]` and only e1 is a node
- **THEN** the result walks from e1, and `unknownRoots` equals `["<uri of ex:nope>"]`

### Requirement: Direction follows the effect-to-cause edge orientation, with alternateOf symmetric

Direction `"backward"` (ancestry, the default) SHALL traverse edges in their asserted
direction (every relation's first-two-formal-attributes edge points effect → cause);
`"forward"` (descendants) SHALL traverse them reversed; `"both"` SHALL be the union of
one backward and one forward walk from the same roots — NOT the undirected connected
component (a sibling output of a shared ancestor is not part of either walk).
`alternateOf` edges SHALL be traversed from both endpoints under every direction (PROV-DM
declares alternateOf symmetric; a one-way traversal would assert an ordering PROV does
not).

#### Scenario: Backward ancestry crosses an entity-activity chain

- **WHEN** `wasGeneratedBy(e2, a1)`, `used(a1, e1)` exist and backward lineage runs from e2
- **THEN** nodes include e2, a1, e1 and edges include both relations

#### Scenario: Forward descendants is the reverse walk

- **WHEN** the same document is walked forward from e1
- **THEN** nodes include e1, a1, e2 — the same edges traversed in reverse

#### Scenario: Both is ancestors plus descendants, not the undirected component

- **WHEN** a1 used e1, a2 also used e1, a1 generated e2, a2 generated e3, and
  `lineage(graph, e2, { direction: "both" })` runs
- **THEN** nodes include e2's ancestors (a1, e1) and e2's descendants (none) but NOT the
  sibling branch (a2, e3), which is reachable only by changing direction mid-path

#### Scenario: alternateOf reaches both ways regardless of direction

- **WHEN** `alternateOf(e1, e2)` exists and backward lineage runs from e2 under a
  relation set that includes Alternate (e.g. `relations: "structure"` — profiles gate
  every edge, so the default dataflow set never traverses an alternate at all)
- **THEN** e1 is reached (even though e2 is the edge's target, not its source)

### Requirement: Relation profiles scope the walk, composing with an injected edge predicate

The `relations` option SHALL accept `"dataflow"` (Generation, Usage, Derivation,
Communication, Start, End, Invalidation), `"responsibility"` (Attribution, Association,
Delegation), `"structure"` (Specialization — and therefore Mention, its subclass —
Alternate, Membership), `"all"` (every relation class including Influence), or an
explicit readonly array of relation classes; the default SHALL be `"dataflow"`.
`ProvInfluence` SHALL belong to no named profile other than `"all"` (it is PROV's
unspecific superrelation). An `edgeWhere` predicate, when supplied, SHALL further
restrict traversal (AND with the profile) — derivation-subtype refinement (e.g. only
`wasRevisionOf`) is expressed through it via the relation's asserted types.

#### Scenario: The default dataflow walk ignores responsibility edges

- **WHEN** a document has `wasGeneratedBy(e2, a1)` and `wasAssociatedWith(a1, ag1)` and
  backward lineage runs from e2 with defaults
- **THEN** a1 is reached but the agent ag1 is not, and the association edge is untraversed

#### Scenario: A profile switch reaches the agent

- **WHEN** the same walk runs with `relations: "all"` (or `"responsibility"` plus
  dataflow classes in an explicit list)
- **THEN** ag1 is reached through the association edge

#### Scenario: Influence traverses only under all

- **WHEN** `wasInfluencedBy(e2, e1)` is the only relation and backward lineage runs from
  e2 with `relations: "dataflow"`, then with `relations: "all"`
- **THEN** e1 is unreached under dataflow and reached under all

#### Scenario: edgeWhere refines derivations to revisions

- **WHEN** e3 derives from e2 via a plain `wasDerivedFrom` and e2 from e1 via a
  `wasRevisionOf`-typed derivation, and backward lineage runs from e3 with an `edgeWhere`
  accepting only edges whose relation's asserted types include `PROV_REVISION`
- **THEN** the walk traverses no edge from e3 (the plain derivation is filtered), and the
  same walk from e2 reaches e1

### Requirement: Depth bounds are per-direction hops; every cutoff is explicit frontier data

The `depth` option SHALL accept a number (applies to every direction run) or
`{ back?, forward? }` (asymmetric, dbt-style); one hop SHALL be one edge traversal.
Unset depth SHALL mean unbounded backed by a hard 1000-hop safety ceiling. A node whose
onward edges were not traversed because a bound was reached SHALL appear in `nodes` AND
in `frontier` with `{ uri, direction, reason: "depth" | "ceiling" }`; a node with no
onward edges at all SHALL NOT be in the frontier (exhaustion is not truncation). Nothing
SHALL truncate silently.

#### Scenario: A depth-1 walk marks the frontier

- **WHEN** a three-hop backward chain is walked from its end with `depth: 1`
- **THEN** the walk stops after one hop, the reached node one hop in is in `frontier`
  with reason `"depth"`, and the chain's true terminal is absent from the result

#### Scenario: Asymmetric bounds apply per direction

- **WHEN** `direction: "both"`, `depth: { back: 2, forward: 1 }` runs on a chain longer
  than both bounds
- **THEN** backward reach is two hops, forward reach is one, and each side's cutoff node
  carries its own frontier entry with the matching direction

#### Scenario: A terminal node is not frontier

- **WHEN** an unbounded backward walk reaches an entity with no generation
- **THEN** that entity is in `nodes` and NOT in `frontier` — exhaustion and truncation
  are distinguishable

#### Scenario: A cycle terminates without markers or hangs

- **WHEN** a command writes and re-reads one entity (`wasGeneratedBy(e, a)` ∧ `used(a, e)`)
  and unbounded backward lineage runs from e
- **THEN** the walk terminates with e and a each appearing once in `nodes`, both edges in
  `edges`, and an empty frontier

### Requirement: The result is flat, deduplicated, and reference-based

`LineageResult` SHALL carry `roots` (resolved root URIs), `unknownRoots`, `nodes` (each
visited node exactly once, BFS discovery order, roots first), `edges` (each traversed
edge exactly once, including across the `"both"` union), and `frontier`. The walk SHALL
NOT copy or create records (nodes and edges are the graph's own objects) and SHALL NOT
mutate the graph.

#### Scenario: A diamond dedups

- **WHEN** e4 was generated by a3 which used e2 and e3, both derived from e1, and
  backward lineage runs from e4
- **THEN** e1 appears exactly once in `nodes` even though two paths reach it, and every
  edge appears exactly once

#### Scenario: Both-union edges are not double-counted

- **WHEN** `direction: "both"` runs on a chain where an edge is reachable from a root in
  each direction
- **THEN** that edge appears once in `edges`
