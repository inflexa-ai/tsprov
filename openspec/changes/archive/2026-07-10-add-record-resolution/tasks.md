## 1. Resolution module

- [x] 1.1 `src/graph/resolve.ts`: `RecordSelector` + `AttributePredicate` types (JSDoc on
  every export; `{}`-matches-everything documented), the exported value-normalization
  function (design D4), and the shared match pass over `graph.document.getRecords()`
  (design D1, D2)
- [x] 1.2 Identifier criteria on `identifier.uri` (prefix/suffix/includes/regex/localpart)
  with `prefix:localpart` `id` resolution via the transform's namespaces and null-identifier
  semantics (design D3)
- [x] 1.3 `resolve` / `resolveUnique` returning the `Resolution` / `UniqueResolution`
  discriminated unions (matched / not-found+sample / resolved / ambiguous; sample cap 10,
  elements first; design D5, D6)
- [x] 1.4 Re-export from `src/graph/index.ts` (barrel line only)

## 2. Tests

- [x] 2.1 `src/graph/resolve.test.ts`: every spec scenario — conjunctive composition,
  prefixed-form id, relation-as-subject, injected `where`, inferred-not-resolvable,
  attribute equals/includes/startsWith incl. QName-by-uri and by-display and multi-valued
  any-match, matched-in-document-order, not-found sample, ambiguous candidates, unique
  resolve; plus `{}` matches all and blank-identifier records matchable by type+attribute
- [x] 2.2 PR #72 shape test: path-equals and unique hash-prefix expressed with built-ins
  (attribute equals / startsWith + resolveUnique) over a small doc, proving the inf-cli
  adapter needs no library changes

## 3. Verification

- [x] 3.1 `tsc --noEmit`, full `bun test`, `bun run build`, `bun run smoke` all green; no
  new dependencies; core barrel untouched
