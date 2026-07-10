## Context

Change #2 of the lineage sequence (`docs/research/lineage-direction.md`, decisions D1–D8;
change #1 shipped `ProvGraph` with `graph.document` exposing the `flattened().unified()`
transform). Prior art (`docs/research/lineage-prior-art.md` §6): resolution and traversal
are separate stages in every surveyed system; git's revision grammar is the contract model
(unique ⇒ result, ambiguous ⇒ loud error with candidates, miss ⇒ helpful orientation);
prov-cpl's `cpl_lookup_object_by_property` is the attribute-lookup precedent. inf-cli
PR #72's `resolveFileRef` (path → all matches; hash; unique ≥6-char hash prefix; ambiguity
error with candidates; not-found error with sample paths) is the consumer this stage must
be able to express via injection + built-ins.

## Goals / Non-Goals

**Goals:**

- One `RecordSelector` type whose fields compose by AND, covering identifier forms, class,
  attribute predicates, and a caller-injected predicate.
- Query outcomes as data (discriminated unions), never thrown: match-set, not-found with
  orientation sample, ambiguity with candidates.
- Resolve over ALL records of `graph.document` — elements and relations.

**Non-Goals:**

- No traversal/walk (change #3), no views (change #4), no fuzzy scoring/ranking (Phase 3
  of the direction doc), no resolution against raw `ProvDocument`s (the graph is the query
  surface; callers without a graph can build one), no new dependencies.

## Decisions

**D1 — Resolution runs over `graph.document.getRecords()`, not over graph nodes.**
Nodes exclude relations and include inferred synthetics; the query subject contract needs
real asserted records (an edge as query subject seeds change #3's walk from both
endpoints), and inferred elements are not asserted records — they must not be resolvable.
The transform is exactly what the graph indexed, so results align with the walk's world.

**D2 — `RecordSelector` is a plain object; supplied fields AND together.**
Fields: `id` (string URI, `QualifiedName`, or `prefix:localpart` — see D3), `idPrefix`,
`idSuffix`, `idIncludes`, `idMatches` (RegExp), `localpart` (exact), `type` (RecordClass or
readonly RecordClass[], the `getRecords` filter contract), `attributes` (array of
`AttributePredicate`), `where` (`(record: ProvRecord) => boolean` — the injection point,
user decision (d)). An empty selector `{}` matches every record — legal and useful
("everything, then filter by class in the walk"), documented rather than forbidden.
Alternative considered: a fluent builder (`select().id(...).type(...)`) — rejected; a plain
object is JSON-friendly, trivially composable, and matches the option-bag idiom used across
the codebase (`UnifiedOptions`).

**D3 — Identifier matching is uri-based; the `prefix:localpart` convenience resolves
against the document's namespaces.** All `id*` fields match on `identifier.uri` (the
canonical key, per the value-equality invariant). A bare `prefix:localpart` string for `id`
is resolved via the transform's `NamespaceManager` (`validQualifiedName` — the same
resolution `getRecord` uses, `bundle.ts:323-330`); if it cannot resolve, the selector
matches nothing and the not-found outcome reports it. Records with `identifier === null`
(relations may be blank) fail every `id*`/`localpart` criterion but still match selectors
that don't constrain the identifier — a blank relation is findable by type + attributes.

**D4 — Attribute predicates compare over one documented normalization.**
`AttributePredicate = { name; equals? | includes? | startsWith? }` with `name` an
`AttrKey` (interned QName constant or `prefix:local` string — the existing
`getAttribute` contract, `record.ts:216-219`). A record matches when ANY of its values
under `name` satisfies the predicate (multi-valued attributes are common). Normalization:
a `QualifiedName` value matches on its `uri` OR its `prefix:localpart` display string; a
`Literal` matches on its `value` string; primitives via `String(...)`. This is PR #72's
`normalizeAttrValue` made a documented contract — hash-prefix resolution becomes
`{ name: "inflexa:hash", startsWith: "abc123" }` + `unique` mode. Alternative considered:
compare via `valueKey` — rejected: `valueKey` encodes type information for equality, which
would make `equals: "42"` silently miss an `xsd:int` 42; user-facing matching wants the
lexical form.

**D5 — Outcomes are discriminated unions; nothing query-shaped throws.**
`resolve(graph, selector)` → `Resolution`:
`{ kind: "matched", records }` (1..n, ALL matches — multiplicity is data) or
`{ kind: "not-found", sample }` (`sample`: bounded list — cap 10, mirroring PR #72's
`NOT_FOUND_SAMPLE` — of the document's record identifiers for orientation, elements first).
`resolveUnique(graph, selector)` → `UniqueResolution`: `{ kind: "resolved", record }`,
`{ kind: "ambiguous", candidates }` (all matches, so the caller can render a git-style
disambiguation list), or the same `not-found`. Rationale: ambiguity and misses are normal
query outcomes, not exceptions (git exits nonzero but *lists candidates*; PR #72 used
neverthrow, which tsprov does not have and will not gain — no new deps). Throwing is
reserved for programmer errors only (nothing in this surface needs one today).

**D6 — Two functions, not a `unique` option.** `resolveUnique` returning a differently-
shaped union beats `resolve(graph, sel, { unique: true })` whose return type would need a
conditional-type contortion for LSP clarity. Both share one internal match pass.

## Risks / Trade-offs

- [Linear scan per resolve — O(records × criteria)] → correct at the documented scale
  (in-memory documents; the graph itself is the per-document index). No premature
  identifier index; `TODO(perf)` seam noted in code if profiling ever demands one.
- [Normalization surprises (e.g. matching a QName by display form when a prefix is
  remapped)] → normalization is a single exported, documented function used everywhere;
  tests pin QName-by-uri and QName-by-display both matching.
- [`{}` matching everything could shock] → documented on the type; `resolveUnique({})` on
  a multi-record document is just an `ambiguous` outcome, which is honest.

## Migration Plan

Pure addition (`resolve.ts` + barrel line + tests). Rollback = delete.

## Open Questions

_None — the direction doc's open micro-decisions for this change (result shape, injection
point) are settled above as D5/D2._
