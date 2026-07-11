# Lineage prior art: standards, toolkits, industry APIs, algorithms, theory

> Companion to [`lineage.md`](lineage.md) (design summary) and
> [`lineage-tsprov-inventory.md`](lineage-tsprov-inventory.md) (codebase facts). Survey run
> 2026-07-10 against primary sources. Verification legend: **[R]** = page/PDF actually read;
> **[S]** = search-snippet confidence only; **[L]** = verified locally against
> `reference/prov/`. Unresolved threads are in §8 — do not silently upgrade an [S] claim.

## 1. W3C standards: nothing to conform to, three things to use

- **PROV-AQ** (https://www.w3.org/TR/prov-aq/) [R] is a Working Group *Note* about *locating*
  provenance over HTTP (`Link` headers, service descriptions, pingback for forward
  provenance). It defines no query language or traversal semantics.
- **PROV-CONSTRAINTS** (https://www.w3.org/TR/prov-constraints/) [R] defines no "provenance
  closure" or bounded subgraph, and derivation is deliberately **not transitive**. What it
  gives a traversal:
  - **Inference 11** (derivation-generation-use): `wasDerivedFrom(e2, e1, a, gen2, use1)` ⟹
    `used(use1; a, e1)` ∧ `wasGeneratedBy(gen2; e2, a)` — fires only for activity-aware
    derivations.
  - **Inferences 5–6**: communication ⟹ an underlying generation/usage pair exists.
  - **Inference 12**: revision ⟹ derivation. **Inference 20**: specialization ⟹ alternate.
  - **Constraints 41–42**: use-precedes-generation orderings — a validation layer (a lineage
    edge violating event order is invalid provenance), not materialized edges.
- **PROV-O + SPARQL property paths** (`?x prov:wasDerivedFrom+ ?anc`) is the RDF world's
  idiom [S], but there is no canonical W3C lineage query, and Moreau's group states SPARQL/
  Cypher fit PROV badly because **PROV relations are n-ary records with payload, not labelled
  edges** (arXiv:2206.06251) [S]. An in-memory typed traversal sidesteps this entirely.
- **IVOA ProvSAP** (arXiv:2204.11486; IVOA wiki PDFs) [S] — the one direct precedent for our
  headline decision: an endpoint taking `(entityId, DEPTH=1..n|ALL, DIRECTION=BACK|FORTH,
  RESPONSEFORMAT=PROV-N|PROV-JSON|…)` and returning **the bounded lineage subgraph as a W3C
  PROV document**. Standardization status unverified (§8).

## 2. PROV toolkits: the field is empty

- Python `prov` [L]: only `get_records(class)` / `get_record(id)` (`model.py:1514,1532`).
  No traversal anywhere. Ecosystem answer = export to Neo4j (`prov-db-connector`,
  `provneo4j`) and write Cypher [S].
- **ProvToolbox** [R-module-list]: model/serialization/validation/summarisation — no
  traversal/query module. The summarisation module is Moreau's frequency-weighted summary
  graphs (aggregation, not lineage) [S].
- **ProvStore/ProvValidator** [S]: document-granularity REST; no intra-document queries.
- **prov-cpl** (Harvard) [R-README]: `cpl_lookup_object` (prefix+name+type),
  **`cpl_lookup_object_by_property`** (key-value attribute lookup — direct prior art for our
  resolver), bundle getters, PROV-JSON export. The TaPP'12 paper claims an ancestry API; not
  found in the current README (§8).
- **PQL** (Harvard PASS, https://syrah.eecs.harvard.edu/pql) [S]: path-query language with
  bidirectional edges; its companion paper argues provenance querying is inherently
  *path-oriented* and relational/XML query languages fit badly.

**Takeaway:** a native in-memory lineage query would be a first in this library family; the
useful precedents are prov-cpl's lookup trio and PQL's bidirectional navigation.

## 3. Industry lineage APIs: one converged shape

- **Marquez** (OpenLineage): `GET /lineage?nodeId=<type:ns:name>&depth=20` → flat `graph`
  array of nodes with `inEdges`/`outEdges` [R]. OpenLineage itself standardizes event
  *collection*, not queries [S].
- **Apache Atlas**: `GET /v2/lineage/{guid}?depth=3&direction=INPUT|OUTPUT|BOTH` →
  `{baseEntityGuid, guidEntityMap, relations}` [S].
- **DataHub**: GraphQL `searchAcrossLineage` (urn + direction + degree filter 1/2/3+);
  docs warn only the shortest path is guaranteed and high-fan-out 3+-hop queries may be
  incomplete — honest admission that unbounded traversal + path enumeration doesn't scale [S].
- **dbt selectors** [R] — the best ergonomics anywhere: `+model` (ancestors), `model+`
  (descendants), **`3+model+2`** (asymmetric depth bounds), `@model` (descendants plus all
  their ancestors — the rebuild set).
- **Egeria** [R]: design vs. operational lineage; **Ultimate Source / Ultimate Destination**
  (roots-only answers); precomputed "lineage warehouse".
- **Spline** [S]: producer (ingest) vs. consumer (query) API separation; multiple
  granularities.

**Takeaway:** `(nodeRef, direction ∈ {up, down, both}, depth bound, filters) → {nodes, edges}`
is the consensus; steal dbt's asymmetric bounds, Atlas's direction enum, Marquez's bounded
default depth, Egeria's roots-only variant. Resolution and traversal are separate stages
*everywhere*; no system fuses fuzzy matching into the walk.

## 4. Algorithms: BFS is provably the right v1

Primary source: SIGMOD 2023 reachability-index tutorial (Zhang/Bonifati/Özsu,
https://chaozhang-cs.github.io/files/sigmod23-tutorial-short.pdf) [R]:

- The field is a spectrum between online BFS and precomputed transitive closure. Families:
  interval labeling (Agrawal '89; GRAIL VLDB'10; Ferrari ICDE'13), 2-hop labeling (Cohen
  SODA'02; PLL; TOL SIGMOD'14 for dynamic), approximate TC / Bloom-filter labels (BFL
  TKDE'17) as cheap negative certificates. Cycles are handled by SCC condensation first
  (Tarjan). Index maintenance under updates is the open pain point.
- **Label-constrained reachability** is our exact setting (typed relation edges): Jin
  SIGMOD'10, P2H+ VLDB'20, DLCR VLDB'22, RLC ICDE'23 — RLC's concatenation patterns like
  `(used · wasGeneratedBy)*` are literally the PROV entity–activity alternation.
- **Why BFS wins for us:** indexes accelerate *boolean* reachability on stable graphs; our
  primary query returns the subgraph itself, which costs Ω(|answer|) regardless — an index
  cannot beat BFS at that job. At 10³–10⁶ in-memory records with mutation between queries,
  build-once adjacency + cycle-safe BFS is correct. Leave a seam for a future
  `isReachable(x, y)` backed by 2-hop/Bloom labels. (Synthesized conclusion — see §8.)
- **Bidirectional BFS** (O(b^(d/2)) per frontier) is the right tool for "how are X and Y
  connected" — phase-2 `connect()`.
- Purdom's algorithm (SCC condensation + reverse-topological successor-set union) if full
  transitive closure is ever needed (e.g. SubRank statistics).

## 5. Database provenance theory: two creative imports

- **Why/how/where provenance** (Cheney–Chiticariu–Tan survey, FnT-DB 2009) [S]: a lineage
  subgraph ≈ why-provenance; its *structure* (which activity combined which entities) is
  how-provenance.
- **Semiring provenance** (Green–Karvounarakis–Tannen, PODS'07) [S] + **ProQL** (SIGMOD'10)
  [R-partial]: a two-operation core — *graph projection* + *annotation computation over the
  projection* — is sufficient for a provenance query language. For us: implement the walk as
  a fold; a pluggable algebra later yields how-expressions (`e1·(e2+e3)`), min-confidence,
  cost sums — one traversal, many explanations. Caveat: reading multiple `used` edges as AND
  and multiple derivations as OR is a heuristic; PROV asserts no conjunction semantics.
- **Underspecified lineage queries** (Margo–Macko–Seltzer, Harvard TR-01-12, 2012) [R]:
  unbounded backward lineage ends at "you installed Linux". **SubRank** (|reverse TC| /
  |nodes|) and **ProvRank** (PageRank-style) truncate the walk where relevance falls off a
  cliff, with thresholds chosen at the largest jump in result size. Phase-3 material.

## 6. Partial-information lookup: the git contract

- **git revisions** (https://git-scm.com/docs/gitrevisions) [R]: abbreviated hash resolves
  iff *unique*; ambiguity is a loud error listing candidates; `:/<text>` regex-matches commit
  messages with a deterministic "youngest wins" tie-break; `<rev>:<path>` names by place.
  The design prior: accept many reference forms, resolve deterministically, fail loudly and
  helpfully.
- **Search-then-traverse** is universal (DataHub search → urn → traverse; Atlas search →
  guid → lineage) [S]; nobody fuses fuzziness into traversal.
- TR-01-12's "underspecification" is about unbounded *scope*, not fuzzy node reference —
  a separate problem (ranking), not a resolver problem.

## 7. Result representations

- Nodes+edges subgraph is the industry norm (Marquez/Atlas) [R/S]; full path enumeration is
  the representation that explicitly does not scale (DataHub) [S].
- **Lineage answer AS a PROV document**: precedented by IVOA ProvSAP [S], Komadu's query API
  (returns provenance graphs) [S], prov-cpl's PROV-JSON export [R], and the First Provenance
  Challenge's query 1 [R via TR-01-12].
- **Validity of a slice** — the ProvAbs lesson (Missier–Moreau, arXiv:1406.1998; FGCS 2020)
  [S]: subsetting PROV while preserving validity is nontrivial (n-ary legs can strand).
  PROV tolerates references to undeclared identifiers (hence Python's inferred-node
  sentinel), so a slice is always *parseable*; whether to widen or dangle is a deliberate
  design decision → settled as direction-doc D4.
- PROV **bundles** are the natural container: a bundle is itself an entity, enabling
  provenance *of the query result* (who queried, when, what parameters).
- Program-slicing theory (Perera–Acar–Cheney–Levy, ICFP'12 Galois slicing) [S] is the PL
  formalization of "smallest sub-history explaining this output" — background, not v1.

## 8. Gaps (explicitly unresolved — re-verify before relying on these)

1. prov-cpl's ancestry API: paper claims it, current README doesn't show it; source not audited.
2. Komadu's exact query operation names live in a user-guide PDF that was not fetched.
3. ProvToolbox: "no query module" concluded from the module list; every module's javadoc was
   not read.
4. git `core.disambiguate` details are from prior knowledge, not the fetched page.
5. ProvSAP's IVOA standardization status (Recommendation vs. working draft) unverified.
6. "BFS is right at our scale" is synthesized from the SIGMOD'23 taxonomy + the Ω(|answer|)
   argument + DataHub's operational limits — no single measured head-to-head benchmark was
   read. Candidate source if numbers are needed: "Graph Reachability Queries: Empirical
   Evaluation and Practical Guidelines" (Springer 2025).
