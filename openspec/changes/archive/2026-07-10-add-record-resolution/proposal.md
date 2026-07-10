## Why

A lineage query starts from a record the caller can rarely name exactly — they hold a
partial identifier, an attribute value (a path, a hash prefix), or a type, not a full URI.
tsprov's only lookups are `getRecord(identifier)` (exact, `bundle.ts:323-330`) and
`getRecords(class)`. Every real lineage system separates *resolution* from *traversal*
(search-then-traverse; `docs/research/lineage-prior-art.md` §6), and inf-cli PR #72 had to
hand-roll exactly this stage (path / hash / unique hash-prefix with a git-style ambiguity
contract). This is change #2 of the lineage sequence
(`docs/research/lineage-direction.md`): the selector stage the walk (change #3) will
consume, independently useful as a `getRecord` generalization.

## What Changes

- `resolve(graph, selector)` over a `ProvGraph`: matches records of the graph's
  transformed document — elements AND relations (an edge is a legal query subject; its
  matches seed a walk from both endpoints in change #3).
- Built-in composable selector forms (all supplied fields must hold — AND): exact
  identifier (URI string, `QualifiedName`, or `prefix:localpart` string resolved against
  the document's namespaces), identifier prefix / suffix / substring / regex, exact
  localpart, record-class filter, attribute predicates (equals / contains / prefix over a
  documented value normalization), and a caller-injectable predicate (`where`) — the
  default-plus-injection contract the user chose (decision (d)).
- Git-style result contract, as data rather than throws: the default result carries ALL
  matches (multiplicity surfaced, never hidden); an empty result carries a bounded sample
  of the document's known identifiers so the caller can orient; `resolveUnique` returns a
  typed ambiguity outcome listing the candidates when more than one record matches.
- No traversal, no views, no new dependencies, nothing added to the core barrel.

## Capabilities

### New Capabilities
- `record-resolution`: resolving a caller's partial reference to the matching records of a
  `ProvGraph`'s document — selector forms, composition, injection, and the
  match-set / not-found / ambiguity result contract.

### Modified Capabilities

_None — `graph-view` requirements are unchanged; this stage only reads the graph._

## Impact

- New `src/graph/resolve.ts` + `src/graph/resolve.test.ts`; re-exported from the existing
  `src/graph/index.ts` subpath barrel only.
- No changes to `ProvGraph`, the core surface, `package.json`, or dependencies.
