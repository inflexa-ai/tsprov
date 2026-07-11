# graph-view Specification

## Purpose

The multi-digraph representation of a PROV document — construction from
`flattened().unified()`, node/edge/adjacency access keyed by `identifier.uri`, and lossless
conversion to and from `ProvDocument` (Python `prov.graph` parity, `reference/prov/src/prov/graph.py`).
The substrate the lineage layers (resolve/walk/views) build on; see
`docs/research/lineage-direction.md`.

## Requirements

### Requirement: The graph subpath exposes the graph layer without touching the core

The package SHALL expose the graph layer only under the `./graph` subpath export
(`@inflexa-ai/tsprov/graph`), wired for ESM, CJS, and types like the root export. The core
barrel (`src/index.ts`) SHALL NOT change, and the graph layer SHALL add no runtime, peer,
or dev dependency. The subpath SHALL typecheck and run for consumers under both
`moduleResolution: bundler` and `nodenext` (the smoke script exercises a subpath import).

#### Scenario: A consumer imports the graph layer from the subpath

- **WHEN** a consumer writes `import { ProvGraph } from "@inflexa-ai/tsprov/graph"`
- **THEN** the import resolves under bundler and nodenext resolution, in ESM and CJS, and
  `src/index.ts` exports nothing graph-related

### Requirement: A ProvGraph is a multi-digraph built from the flattened, unified document

`ProvGraph.of(document, options?)` SHALL build the graph from
`document.flattened().unified(options)` — bundled records participate (intentional
divergence from Python, logged in `DEVIATIONS.md`) — and SHALL expose the transformed
document it indexed as `graph.document`. Every `ProvElement` in the transformed document
becomes a node keyed by `identifier.uri`; every relation whose first two formal attributes
both resolve to a QName becomes one edge from the first endpoint to the second carrying the
full relation record; parallel edges are all kept in document order. The graph SHALL provide
forward and reverse adjacency (edges by source uri, edges by target uri), a node lookup by
uri, and iteration over all nodes and all edges. All collections SHALL be keyed by uri
strings, never by object reference. The original input document SHALL NOT be mutated.

#### Scenario: Elements become nodes and relations become payload-carrying edges

- **WHEN** a document contains `entity(e1)`, `activity(a1)`, and `wasGeneratedBy(e1, a1)`
- **THEN** the graph has nodes keyed by e1's and a1's uris and one edge e1 → a1 whose
  payload is the `ProvGeneration` record itself

#### Scenario: Records inside bundles participate

- **WHEN** a document's only relation lives inside a bundle
- **THEN** the graph contains that relation as an edge (Python's converter would not), and
  `graph.document` is the flattened, unified transform

#### Scenario: Parallel relations are distinct edges

- **WHEN** two `used(a1, e1)` records with different attributes exist
- **THEN** the graph has two edges a1 → e1, in document order, each carrying its own record

#### Scenario: Reverse adjacency answers "what points at X"

- **WHEN** `wasGeneratedBy(e1, a1)` and `used(a2, e1)` are in the document
- **THEN** the reverse adjacency for e1's uri yields the usage edge (a2 → e1) and the
  forward adjacency for e1's uri yields the generation edge (e1 → a1)

### Requirement: Endpoints referenced but never declared become inferred nodes

An edge endpoint whose QName has no declared element in the transformed document SHALL
become a node flagged `inferred`, carrying a synthetic element of the class Python's
`INFERRED_ELEMENT_CLASS` maps for that formal-attribute position (`graph.py:36-56`).
Python's `prov:bundle → ProvBundle` entry is deliberately not ported: it is unreachable
(`prov:bundle` is only ever `mentionOf`'s third formal attribute and edge extraction reads
the first two), and a `ProvBundle` is not a `ProvElement` — omitting it is behaviorally
identical on every document. The synthetic element SHALL be constructed
against the transformed document as its qualified-name resolver WITHOUT being registered in
it. A relation whose first or second formal attribute is missing (`undefined`) SHALL be
skipped, and a relation whose first or second formal-attribute QName is not in the
inferred-class map SHALL be skipped (Python's caught `KeyError`, `graph.py:85-87`). Skips
SHALL be observable (a count or list on the graph), never silent.

#### Scenario: A generation pointing at an undeclared activity infers an activity node

- **WHEN** `wasGeneratedBy(e1, a1)` exists but `a1` was never declared
- **THEN** the graph has an `inferred: true` node for a1 whose element is a synthetic
  `ProvActivity`, the document is not mutated, and the edge e1 → a1 exists

#### Scenario: A relation missing an endpoint is skipped observably

- **WHEN** `wasGeneratedBy(e1)` has no activity attribute
- **THEN** the graph contains no edge for it, e1 is still a node if declared, and the skip
  is visible on the graph's skip accounting

### Requirement: provToGraph and graphToProv convert with Python parity

`provToGraph(document, options?)` SHALL return `ProvGraph.of(document, options?)`.
`graphToProv(graph)` SHALL build a fresh `ProvDocument` containing every non-inferred
node's element and every edge's relation record (Python `graph.py:92-113`; the
`inferred` flag replaces Python's `bundle is None` sentinel). Round-tripping a document
through both SHALL yield a document equal (`ProvDocument.equals`) to
`document.flattened().unified()` whenever no relation was skipped during conversion.

#### Scenario: Corpus round-trip equals the flattened unified transform

- **WHEN** each of the 398 corpus documents is round-tripped via
  `graphToProv(provToGraph(doc))`
- **THEN** for every document with zero conversion skips the result equals
  `doc.flattened().unified()`, and for documents with skips the test asserts the skip
  accounting explains exactly the missing records — no silent losses

#### Scenario: Inferred nodes do not come back

- **WHEN** a graph containing an inferred node is converted with `graphToProv`
- **THEN** the resulting document declares no element for the inferred QName, while the
  relation referencing it is present
