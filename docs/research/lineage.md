Native lineage in tsprov: what exists, what others do, and the design space

TLDR: PR #72 proves the walk works, but it hand-rolls, app-side, exactly the machinery a PROV library should own: an adjacency index, a resolve-by-partial-info stage, a cycle-safe bounded traversal, and two output shapes. tsprov today has zero traversal support (finding "all relations touching X" is an O(n) scan), but the M8 roadmap milestone (tsprov/graph) already reserves the natural home for it. Nobody in the PROV library family ships native lineage queries — they all punt to Neo4j/SPARQL after export — so this would be a genuine differentiator. The design space decomposes into four independent layers (resolve → traverse → represent → optimize), and the single highest-leverage decision is: return the lineage answer as a valid PROV document/bundle, not a bespoke tree — precedented by IVOA's ProvSAP, and the one thing an app-side implementation like PR #72 fundamentally can't offer.

---
1. What the two artifacts establish

Issue #66 asks for inflexa prov lineage <path|hash>: the recorded graph already contains one wasGeneratedBy per file, used edges per command/step, and a wasInformedBy activity spine; backward lineage is file → wasGeneratedBy → activity → used → inputs, recursing, and forward is the reverse. Cross-run chains merge for free because file entities are keyed (path, hash) in one QName space.

PR #72 implements it in ~500 lines (cli/src/modules/prov/lineage.ts), and its pipeline is worth internalizing because it's the shape everything else in this survey converges on:

1. Index once — one pass over getRecords(ProvGeneration | ProvUsage | ProvCommunication) building six Map<string, string[]> (both directions of generation and usage, informedBy, plus an attribute bag per element).
2. Resolve — exact path → all matching entities (multiplicity surfaced, not hidden), exact hash, or unique hash prefix ≥ 6 chars; ambiguity fails listing candidates; a miss fails listing sample paths.
3. Walk — recursive, whole-walk visited set, explicit revisit/depth markers (a truncated branch must never look like a completed one), 1000-hop safety ceiling, depth-cut nodes deliberately not marked visited so a shallower path can still expand them.
4. Render — human tree, or flat {roots, nodes, edges} with edges always in PROV semantics regardless of walk direction.

The honest-rendering discipline (markers, grain labels, "no recorded inputs" ≠ "no inputs") is the PR's best idea and should survive any generalization.

2. What generalizes and what doesn't

┌────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────────────┐
│                            PR #72 piece                            │                                         Verdict                                          │
├────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
│ Six adjacency maps keyed by QName string                           │ General — belongs in tsprov (and matches the repo's string-key equality invariant)       │
├────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
│ Visited set + depth + explicit truncation markers                  │ General                                                        │
├────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ Flat nodes+edges output in PROV edge semantics                     │ General (as one of the views)                                                            │
├────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
│ Resolve-by-partial-info with a git-style ambiguity contract        │ The patterc matchers (inflexa:path, hash prefix) stay app-side │
├────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ Only 3 of 15 relation types walked                                 │ App-specif all 15, with configurable subsets                   │
├────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
│ Step-grain labels, command/exitCode context, inflexa:file-* scheme │ App-specifn of a library result                                │
└────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────────────────┘

If tsprov ships the general layer, PR #72's lineage.ts collapses to: a resolver cers + a prefix rule), a call to the library, and the inflexa-flavored formatters.

3. What tsprov has today (verified, file:line)

- Storage is an ordered _records: ProvRecord[] plus _idMap: Map<string, ProvRecor own identifier.uri (src/bundle.ts:166-168). There is no endpoint index — no way to ask "which relations touch entity X" except a linear scan. Exhaustive greps for traversal/closure/adjacency/graph code found nothing.
- Every relation exposes its edge uniformly: the first two entries of formalAttributes are the endpoints (src/record/record.ts:233-241), guaranteed QualifiedNames when present
(record.ts:335-348) — the exact convention Python's graph.py:76-78 slices. I veri all 15 classes (src/record/relation.ts:62-202); note alternateOf is symmetric, and
revision/quotation/primary-source are asserted types on ProvDerivation (getAssert09), not classes — a lineage filter that distinguishes them must check assertedtypes.
- unified() deduplicates same-id records but does not flatten bundles; flattened() (src/document.ts:121-134) does. Python's prov_to_graph unifies first (graph.py:68) and only ever sees document-level records — a known blind spot we can improve on.
- The Python reference's entire graph story is prov_to_graph/graph_to_prov — a Nethetic "inferred nodes" (built with a bundle=None sentinel) for endpoints that were
referenced but never declared. No traversal, no query — consumers are expected to
- Roadmap M8 (docs/migration/02-migration-roadmap.md:213-222) already plans src/graph.ts under a tsprov/graph subpath export, with the dependency analysis recommending a hand-rolled ~40-line MultiDiGraph keyed by identifier.uri over graphology (03-dependency-analysis.md:75-80) — zero new dependencies. The pre-M6 fence on touching it is lifted (M0–M6 complete, 640 tests green). But the docs plan M8 as a pure format converter; a query API on top is new scope.

4. Prior art — the load-bearing findings

Standards: there is nothing to conform to, and that's freedom. PROV-AQ (a Note, not a Rec) standardizes finding provenance over HTTP, not querying it — its only lineage-relevant idea is
"pingback" for forward provenance. PROV-CONSTRAINTS never defines a "provenance ch, and derivation is deliberately not transitive. What it does give us is Inference 11: wasDerivedFrom(e2, e1, a, …) implies used(a, e1) and wasGeneratedBy(e2, a) — plus communication ⇒ usage/generation (Inf. 5–6) and revision ⇒ derivation (Inf. 12). A smart traversal can optionally apply these so sparse documents still walk. Moreau's own group notes SPARQL/Cypher fit PROV badly because PROV relations are n-ary records with payload, not labelled edges — an in-memory typed traversal sidesteps that entirely.

The one direct precedent for "query returns PROV": the astronomy community's IVOAing (entityId, DEPTH=1..n|ALL, DIRECTION=BACK|FORTH,RESPONSEFORMAT=PROV-N|PROV-JSON|…) and returning the bounded lineage subgraph as a W3C PROV document. That is precisely the native capability we're discussing.
Toolkits: the field is empty. Python prov has only get_record(s); ProvToolbox has merge/summarize/validate but no traversal; ProvStore is document-granularity; the ecosystem answer is "export to Neo4j, write Cypher." The two useful precedents: prov-cpl's lookup trio (by id / by name+type / by property — direct prior art for partial-info resolution) and Harvard PQL's argument that provenance querying is inherently path-oriented with bidirectional navigation.
Industry lineage APIs converge on one shape. Marquez: GET /lineage?nodeId=…&depth=20. Atlas: GET /lineage/{guid}?depth=3&direction=INPUT|OUTPUT|BOTH returning {baseEntityGuid, guidEntityMap relations}. DataHub: search-then-traverse with a degree filter — and an honest wafan-out traversal with full path enumeration doesn't scale. dbt has the bestergonomics anywhere: +model (ancestors), model+ (descendants), 3+model+2 (asymmetric depth bounds), @model (descendants plus everything needed to rebuild them). Egeria adds "Ultimate Source/Destination" — roots-only answers that skip the middle. Every one of these separates resolution (search/id) from traversal; none fuses fuzzy matching into the walk.

Algorithms: BFS is provably the right v1. The SIGMOD'23 reachability-index tutorial frames the field as a spectrum from online BFS to precomputed transitive closure (interval labeling/GRAIL 2-hop/PLL, Bloom-filter labels). But those accelerate boolean reachability on staery returns the subgraph itself, which costs Ω(|answer|) no matter what — an index cannot beat BFS at that job. At in-memory scale (10³–10⁶ records) with documents s, a per-document build-once adjacency index + cycle-safe BFS is correct; the seam to leave open is a future isReachable(x, y) backed by 2-hop/Bloom labels. One pleasing theory connection: "label-constrained reachability" with concatenation patterns like (used ·
wasGeneratedBy)* — the literature term for exactly the entity–activity alternatiorectional BFS (O(b^(d/2)) per frontier) is the right tool for a "how are X and Yconnected?" query.

Theory: two genuinely creative imports.
- Semiring provenance (Green–Karvounarakis–Tannen, PODS'07) and ProQL (SIGMOD'10)e suffices: subgraph projection + annotation computation over it. Concretely:design the traversal as a fold with a pluggable algebra — the trivial algebra yields the subgraph; other algebras yield how-provenance expressions (output = e1·(e2+e3) — "e1 AND (e2 OR e3)"), min-confidence along paths, cost sums, or latest-source timestamps, all from one traversal. (Caveat: reading multiple used edges as AND and multiple derivations as OR is a heuristic — PROV doesn't assert conjunction semantics.)
- Underspecified lineage queries (Harvard TR-01-12): unbounded backward lineage eears ago you installed Linux." Their fix — SubRank/ProvRank, topology-onlyfrequency metrics that truncate the walk where relevance falls off a cliff — is troblem inf-cli will hit the moment documents span many runs.

Result-validity subtlety (the ProvAbs lesson): naively slicing a PROV graph can strand the n-ary legs of a relation (a derivation's activity/generation/usage references). PROV tolerates references to undeclared identifiers (that's what Python's inferred-node sentinel handles), so a slice is always parseable — but you must decide per relation: widen the subgraph to include referenced legs, or accept dangling references. That decision is a design point, not an accident.

5. The design space — four layers to reason through

Layer 1: Resolution (your "ID, node, edge, or partial info"). A resolve(selector) stage, separate from traversal, returning matched records with a git-style contract (unique → node; ambiguous → error carrying candidates; an explicit opt-in like git's :/text "youngest wins" for auto-picking). Selector forms, in increasing fuzziness: exact QualifiedName/URI → localpart or suffix match → substring/regex over identifiers → attribute predicate ({ attr: "inflexa:path", equals/contains/prefix } — prov-cpl's lookup_object_by_property) → record-class filter, composable with all of the above. An edge as query subject falls out naturally: relations are records with identifiers; resolving one seeds the traversal from both endpoints.

Layer 2: Traversal. Direction backward | forward | both (PROV edges point effect→cause, so backward = follow edges as asserted). Relation-set profiles rather than all-15-always: dataflow (generation, usage, derivation, communication, start/end/invalidation), responsibility (attribution, association, delegation), structure (specialization, alternate, membership, mention), all — or an explicit class list. Depth bounds, ideally dbt-style asymmetric (3+node+2 semantics as { back: 3, forward: 2 }). Cycle policy: whole-walk visited set with explicit markers (keep PR #72's discipline verbatim). Optional inference mode: expand Inference 11/5/6/12 edges, labeled as inferred — never silently mixed with asserted edges.

Layer 3: Representation. This is where "native" earns its keep. The primary result should be a valid PROV document (or named bundle) containing the lineage subgraph — ProvSAP-style — because then the answer serializes to PROV-JSON/PROV-N for free, feeds any downstream PROV tool, can be diffed/unified/re-queried, and (cute but real) can carry provenance of the query itself as a
bundle-level activity. Derived, cheaper views on top: flat {roots, nodes, edges} d), and paths(x → y) for connection explanations. The tree rendering stays app-side
— it's presentation.

Layer 4: Performance. A GraphView-style build-once index object over doc.flattened().unified() (fixing Python's bundle blind spot), keyed by URI strings per the repo's value-equality invariant, holding forward/reverse adjacency per relation class plus the full relation record as edge payload (n-ary data preserved — the thing SPARQL/Cypher lose). BFS on demand; no
reachability index in v1; leave the isReachable seam documented as a TODO(perf).

6. Creative differentiators, ranked by value-per-effort

1. Result-as-PROV-bundle — the native killer feature; moderate effort (the closure/dangling-legs decision is the only hard part).
2. Connection query (connect(x, y) via bidirectional BFS) — answers "is this output tainted by that input?", cheap once the index exists.
3. Inference-aware edges (PROV-CONSTRAINTS 11/5/6/12) — makes sparse third-party documents walkable; small, well-specified.
4. Ultimate-source/roots-only mode (Egeria) — trivial on top of the walk, high CLI ergonomics.
5. Pluggable fold/algebra (semiring how-provenance, confidence, cost) — the most intellectually distinctive; ship the hook in v1 (the walk is already a fold), the algebras later.
6. ProvRank-style relevance truncation — defer until someone actually hits the "i a research-grade feature.

7. Suggested phasing and the decisions that are yours

Phase 1 (reframed M8): tsprov/graph = index/GraphView + provToGraph/graphToProv parity with Python (inferred-node sentinel included) + resolve + lineage(direction, depth, profile) + document/nodes-edges outputs. Zero new dependencies, consistent with the M8 plan. Phase 2: connection queries, inference mode, roots-only. Phase 3: algebras, ranking, tsprov/dot visualization (which then closes #66's descoped --format dot for free).

Open decisions I'd want your call on before speccing: (a) does this replace M8's nd beside it; (b) result-validity policy — widen the subgraph to include n-aryrelation legs, or allow dangling references (I lean widen-by-default with an opt-out); (c) does the fluent record API grow conveniences like entity.lineage(), or does everything stay behind the tsprov/graph subpath (I lean subpath-only — keeps the core dependency-light a (d) whether the resolver's fuzzy tier belongs in the library or stays acaller-supplied predicate (I lean: predicates + prefix/substring in the library, domain semantics like "path" in the caller).

My working notes (including the full 15-relation direction table and both agents' verified reports) are in the session scratchpad if you want the raw material. If you tell me where you land on (a)–(d), I can draft the actual API spec against docs/migration/04-typescript- as the next step.
