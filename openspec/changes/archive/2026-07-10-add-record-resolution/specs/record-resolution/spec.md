# record-resolution Delta Specification

## ADDED Requirements

### Requirement: A selector composes identifier, class, attribute, and injected criteria by AND

`resolve(graph, selector)` SHALL match records of `graph.document` (elements AND
relations — never the graph's inferred synthetic elements) against a plain-object
`RecordSelector` whose supplied fields must ALL hold: `id` (URI string, `QualifiedName`,
or `prefix:localpart` string resolved against the document's namespaces), `idPrefix`,
`idSuffix`, `idIncludes`, `idMatches` (RegExp) — all matching on `identifier.uri` —
`localpart` (exact), `type` (record class or classes, the `getRecords` filter contract),
`attributes` (predicates per the attribute-matching requirement), and `where` (a
caller-injected `(record) => boolean` — the custom-matcher injection point). An empty
selector SHALL match every record. A record with a `null` identifier SHALL fail every
identifier criterion while remaining matchable by non-identifier criteria.

#### Scenario: Composed criteria narrow conjunctively

- **WHEN** a document has entities `ex:e1`, `ex:e2` and activity `ex:a1`, and the selector
  is `{ idPrefix: "http://example.org/", type: ProvEntity }`
- **THEN** exactly `e1` and `e2` match — the activity is excluded by `type`, and nothing
  outside the uri prefix matches

#### Scenario: A prefixed-form id resolves via the document's namespaces

- **WHEN** the document declares prefix `ex` and the selector is `{ id: "ex:e1" }`
- **THEN** the entity whose `identifier.uri` is the expansion of `ex:e1` matches

#### Scenario: A relation is a legal query subject

- **WHEN** a `wasGeneratedBy` relation carries identifier `ex:gen1` and the selector is
  `{ id: "ex:gen1" }`
- **THEN** the relation record itself is the match

#### Scenario: The injected predicate composes with built-ins

- **WHEN** the selector is `{ type: ProvEntity, where: (r) => myCustomRule(r) }`
- **THEN** only entities for which the injected predicate returns true match

#### Scenario: Inferred graph nodes are not resolvable

- **WHEN** the graph inferred a node for an undeclared endpoint `ex:ghost` and the
  selector is `{ id: "ex:ghost" }`
- **THEN** the outcome is not-found — inferred synthetics are not asserted records

### Requirement: Attribute predicates match any value under one documented normalization

An `AttributePredicate` `{ name, equals? | includes? | startsWith? }` SHALL match a record
when ANY of the record's values under `name` (the existing `getAttribute` key contract)
satisfies the predicate over the documented normalization: a `QualifiedName` value matches
on its `uri` or its `prefix:localpart` display form; a `Literal` matches on its lexical
`value`; other values via their string form. The normalization SHALL be one exported,
documented function.

#### Scenario: A hash prefix resolves via startsWith

- **WHEN** an entity carries `ex:hash = "abc123def456"` and the selector is
  `{ attributes: [{ name: "ex:hash", startsWith: "abc123" }] }`
- **THEN** that entity matches — the PR #72 hash-prefix use case expressed with built-ins

#### Scenario: A QName-valued attribute matches by uri and by display form

- **WHEN** an entity carries `prov:type = prov:Collection`
- **THEN** predicates with `equals` set to the full uri or to `"prov:Collection"` both match

#### Scenario: Multi-valued attributes match on any value

- **WHEN** an entity carries two `ex:tag` values `"raw"` and `"published"`
- **THEN** `{ name: "ex:tag", equals: "published" }` matches the entity

### Requirement: Resolution outcomes are typed data with a git-style contract

`resolve` SHALL return `{ kind: "matched", records }` carrying ALL matches in document
order (multiplicity surfaced, never hidden) or `{ kind: "not-found", sample }` where
`sample` is a bounded (10) orientation list of the document's record identifiers.
`resolveUnique` SHALL return `{ kind: "resolved", record }` for exactly one match,
`{ kind: "ambiguous", candidates }` carrying all matches for more than one, or the same
not-found outcome. No query outcome SHALL be thrown.

#### Scenario: All matches are returned in document order

- **WHEN** three entities share the localpart `report` and the selector is
  `{ localpart: "report" }`
- **THEN** the outcome is `matched` with all three records in document order

#### Scenario: A miss orients the caller

- **WHEN** no record matches `{ id: "ex:nope" }` in a document with 40 records
- **THEN** the outcome is `not-found` and `sample` lists at most 10 known identifiers

#### Scenario: Uniqueness violations list candidates instead of guessing

- **WHEN** `resolveUnique` runs a selector matching two records
- **THEN** the outcome is `ambiguous` with both candidates — the caller can render a
  git-style disambiguation list

#### Scenario: A unique match resolves

- **WHEN** `resolveUnique` runs a selector matching exactly one record
- **THEN** the outcome is `resolved` with that record
