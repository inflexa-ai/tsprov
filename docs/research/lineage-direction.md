# BINDING DIRECTION — native lineage queries in tsprov

> **This document is the binding direction for the lineage effort.** The loop
> (`loop.md`) follows it; an OPSX change that contradicts it without an explicit
> user decision is wrong. Background: [`lineage.md`](lineage.md) (design summary),
> [`lineage-tsprov-inventory.md`](lineage-tsprov-inventory.md) (verified codebase facts),
> [`lineage-prior-art.md`](lineage-prior-art.md) (external survey). Progress is tracked in
> [`lineage-progress.md`](lineage-progress.md).
>
> Motivating artifacts: inflexa-ai/inf-cli issue #66 and PR #72 — an app-side lineage walk
> whose general machinery belongs in this library. After this ships, inf-cli's
> `lineage.ts` should collapse to a resolver config + one library call + formatters
> (that adapter is inf-cli work, **not** part of this effort).

## Settled decisions (user-confirmed 2026-07-10)

- **D1 — The library owns the capability.** The CLI/consumer side should be minimal: supply
  domain matchers, call the library, format. Anything a generic PROV consumer would need
  belongs here, not app-side.
- **D2 — Everything lives under the `./graph` subpath export.** Query is a separate,
  optional concern: no additions to `src/index.ts` or the core record/bundle surface, no
  fluent conveniences like `entity.lineage()`. The core stays luxon-only and unaware of the
  graph layer. (`package.json` gains the `./graph` subpath per
  `docs/migration/03-dependency-analysis.md:246-287`.)
- **D3 — Resolution ships default matchers, callers can inject their own.** Built-in
  selector forms: exact QName/URI, localpart/suffix, substring/regex over identifiers,
  record-class filter, attribute predicates (equals/contains/prefix), all composable.
  Domain semantics (e.g. inf-cli's `inflexa:path` + hash-prefix rule) arrive as a
  caller-supplied matcher via options — same contract, injected.
- **D4 — The walk never widens; the document view closes over references by default.**
  Depth bounds are exact in the walk and its result object (the ground truth: nodes,
  relations, roots, truncation frontier). Materializing the result as a PROV document
  defaults to a **one-pass reference closure** (`closure: "referenced"`): every record
  referenced by an included relation (n-ary legs — derivation's activity/generation/usage,
  association's plan, start/end's starter/ender, mention's bundle — and frontier endpoints)
  is included as its full declaration; the closure chases *references*, never adjacency, so
  it terminates in one bounded pass. `closure: "none"` opts out (exact slice; dangling
  identifier references are legal PROV). Closure-added records are distinguishable from
  walked records in the result. Optionally (opt-in, default off), frontier entities are
  annotated with an attribute in a dedicated query namespace so even the serialized document
  carries the cutoff marker in-band.
- **D5 — Zero new dependencies.** Hand-rolled MultiDiGraph per
  `03-dependency-analysis.md:75-80`. No graphology, no dot dep (dot/visualization is
  explicitly out of scope for this effort).
- **D6 — Honesty discipline (inherited from PR #72).** Truncated and cyclic branches carry
  explicit markers (`revisit` / `depth`) in every representation; a safety ceiling backs
  "unbounded"; absence of a recorded edge is never presented as certainty that none existed.
  Depth-cut nodes are not marked visited, so a shallower encounter elsewhere can still
  expand them.
- **D7 — String keys.** All graph structures key by `identifier.uri` / `.key` (the repo's
  value-equality invariant). Never object-keyed Maps/Sets.
- **D8 — Edge extraction is the first-two-formal-attributes convention**, with the full
  relation record riding as edge payload (n-ary data preserved). Converter functions match
  Python `graph.py` behavior exactly (skip relations missing either endpoint, synthesize
  inferred nodes with a bundle-less sentinel); whether the *query index* additionally keeps
  one-endpoint relations reachable from their present endpoint is a spec-time micro-decision
  (see below).

## The change sequence (one OPSX change per loop iteration, in order)

### 1. `add-graph-view` — the substrate
`src/graph.ts` (or `src/graph/` if the spec justifies splitting) under the `./graph`
subpath: the hand-rolled MultiDiGraph built from `doc.flattened().unified()` — forward and
reverse adjacency per relation class, relation records as edge payload — plus Python-parity
`provToGraph`/`graphToProv` (inferred-node sentinel included, `graph.py:59-113`).
**Exit:** converter round-trip parity against the Python `test_graphs.py` corpus/examples;
build (ESM+CJS+types) green with the new subpath resolving under both `bundler` and
`nodenext`; flattened+unified behavior for bundled documents logged in `DEVIATIONS.md`
(Python never sees inside bundles).

### 2. `add-record-resolution` — the selector stage
`resolve(view, selector, opts?)`: the D3 selector union + injectable matcher; git-style
contract — result carries **all** matches (multiplicity surfaced, PR #72's D2), typed
ambiguity/not-found errors carrying candidates/samples. Independently useful as a
`getRecord` generalization.
**Exit:** every selector form + composition + injection tested; ambiguity and no-match
paths return typed errors, never throws-with-prose-only.

### 3. `add-lineage-walk` — the query core
`lineage(view, roots, opts)`: direction `backward | forward | both`; relation-set profiles
`dataflow` / `responsibility` / `structure` / `all` / explicit class list (with
asserted-type refinement for derivation subtypes); asymmetric depth bounds
(`{ back, forward }`, dbt's `3+model+2` semantics); whole-walk visited set; `revisit`/`depth`
markers; safety ceiling; `alternateOf` treated as symmetric. Returns the result object
(nodes, relations, roots, frontier) — no document materialization yet. Implement the
traversal as a fold internally (the phase-2 algebra hook depends on it), but expose no
algebra API.
**Exit:** cycle, diamond, depth-cutoff, profile-filtering, direction, and multi-root cases
tested over documents that exercise all 15 relation classes.

### 4. `add-lineage-views` — representations
On the walk result: `.document({ closure: "referenced" | "none", annotateFrontier?: boolean })`
per D4; `.graph()` flat `{roots, nodes, edges}` with edges in PROV semantics regardless of
walk direction; `paths()` between a root and a named node. Serialization of the document
view falls out of existing serializers.
**Exit:** document view round-trips through PROV-JSON/PROV-N; closure-vs-none difference
tested on an activity-aware derivation (n-ary legs); truncation distinguishable from
terminal absence in every view.

**Explicitly deferred (do NOT let specs grow these):** `connect(x, y)` bidirectional search,
PROV-CONSTRAINTS inference mode (Inf. 11/5/6/12), ultimate-source/roots-only mode, public
fold/algebra API, ProvRank-style relevance truncation, `tsprov/dot`, any reachability index
(leave an `isReachable` seam as a `TODO(extend)` comment at most).

## API shape (non-binding sketch — specs refine, direction holds)

```ts
import { GraphView, resolve, lineage } from "@inflexa-ai/tsprov/graph";

const view = GraphView.of(doc);              // flattened().unified() inside, build-once
const matches = resolve(view, { attribute: { name: "ex:path", contains: "results" } });
const result = lineage(view, matches.records, {
  direction: "backward",
  depth: { back: 3 },
  relations: "dataflow",
});
result.document();                            // valid standalone ProvDocument (D4)
result.graph();                               // flat { roots, nodes, edges }
```

## Spec-time micro-decisions (each spec settles its own; record the choice in the design doc)

- Naming: `GraphView` vs `ProvGraph`; free functions vs methods; option-bag shapes.
- Whether the index keeps one-endpoint relations reachable from their present endpoint
  (converter parity says skip; the query index may reasonably keep them as incident data).
- `wasInfluencedBy` profile membership (currently `all`-only — too unspecific to classify).
- The query-namespace URI for the opt-in frontier annotation.
- How `graphToProv` treats a view built with the query extensions (round-trip scope).
- Whether `mentionOf`'s bundle leg participates in closure or stays a bare reference.
