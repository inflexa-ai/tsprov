# 05 — Migration Progress Log

> A running, append-only log of implementation progress. **Each agent adds a new
> dated entry at the top** (newest first) describing what shipped, the state of the
> build, decisions/deviations, and the recommended next item. Planning docs are
> `00`–`04`; this is where execution is tracked.
>
> Read `00-overview.md` + the roadmap (`02`) for the plan, then the most recent
> entry here for where things stand.

---

## Status at a glance

| Layer (roadmap build order) | Module(s) | State |
|---|---|---|
| intern + identifier | `src/intern.ts`, `src/identifier.ts` | ✅ **done + tested** |
| constants | `src/constants.ts` | ✅ **done + tested** |
| literal + datetime | `src/literal.ts`, `src/datetime.ts` | ✅ **done + tested** (luxon installed) |
| error | `src/error.ts` | ✅ **done + tested** |
| value (`valueKey`) | `src/value.ts` | ✅ **done + tested** (equality foundation) |
| format (`%g`, quoting) | `src/format.ts` | ✅ **done + tested** |
| record/attributes | `src/record/attributes.ts` | ✅ **done + tested** (AttributeStore) |
| record/record (`ProvRecord`) | `src/record/record.ts` | ✅ **done + tested** |
| record (elements/relations) | `src/record/{element,relation}.ts` | ✅ **done + tested** (all 18 classes) |
| record/registry + `copy()` | `src/record/registry.ts` | ✅ **done + tested** (M3 COMPLETE) |
| namespace-manager | `src/namespace-manager.ts` | ✅ **done + tested** |
| bundle (`ProvBundle` + builders) | `src/bundle.ts` | ✅ **done + tested** |
| document | `src/document.ts` | ✅ **done + tested** (M4 core complete) |
| serializers (provn + infra) | `src/serializers/{serializer,provn}.ts` | ✅ **done + tested** (byte-exact PROV-N) |
| serializers (json) + corpus oracle | `src/serializers/json.ts` | ✅ **done — 398/398 corpus round-trip GREEN** |
| fluent record methods + `read()` | `src/record/element.ts`, `src/read.ts` | ✅ **done + tested** |
| M6 release prep (README, CHANGELOG, API curation) | `README.md`, `CHANGELOG.md`, `package.json`, `index.ts` | ✅ **done** |
| container transformations (`unified`/`update`/`addBundle`) | `src/bundle.ts`, `src/document.ts` | ✅ **done + tested** (M4 fully complete) |
| M6 polish (`.d.ts` strip-internal + consumer check) | `tsconfig.build.json` | ✅ **done** |
| namespace-manager | `src/namespace-manager.ts` | ⬜ not started |
| bundle + document | `src/bundle.ts`, `src/document.ts` | ⬜ not started |
| serializers (json, provn) | `src/serializers/*` | ⬜ not started |

Milestone progress: **M0 partially done** (greeting scaffold replaced; CI/biome/fixture-export
still TODO), **M2 COMPLETE** (identifier, intern, constants, literal, datetime, error all done),
plus `value.ts`/`valueKey`. **M0–M6 (the full v1 scope) COMPLETE.** Container transformations,
`.d.ts` strip-internal, and a consumer-side typecheck (bundler + nodenext) all done. Remaining is
purely post-v1: PROV-N byte-differential, then M7 CLI / M8 graph+dot / M9 XML+RDF.

---

## 2026-06-19 · entry 22 — idiomatic-TS pass (5): `interface` → `type` for the two contracts

**Build:** `bun test` 629 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green. No behavior or
API-shape change (only the declaration keyword).

### What shipped

- **`RecordBundle` (`record.ts`) and `Serializer` (`serializers/serializer.ts`) are now `type`
  aliases**, not `interface`s — applying CLAUDE.md's "Prefer `type` over `interface`". Both are plain
  contracts `implements`-ed by classes (`ProvBundle implements RecordBundle`; `ProvNSerializer` /
  `ProvJsonSerializer implements Serializer`), and a class implements an object `type` exactly as it
  does an interface, so nothing downstream changed. Neither needed interface-only features
  (declaration merging / `extends`). They are **not** the "PROV record hierarchy" the convention
  carves out — that exception is about the record *classes*, not these resolver/serializer contracts.
  No `interface` declarations remain in non-test `src/`.

### Status — idiomatic sweep is winding down

Five passes this session (entries 18–22). The mechanical, clearly-correct idiomatic gaps are closed:
finite string-set → union (`ProvFormat`), boolean checks → type guards, a deferred Python filter
restored with sound generics (`getRecords`), non-null assertions removed, `interface` → `type`. What
remains genuinely needs a **focused session** (see entry 21): the `newRecord` builder casts (a
`constants.ts` QName→class branding refactor that changes exported constant types — wants sign-off)
and the branded entity/activity/agent refs (a DX project). Not loop-tick work.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 21 — idiomatic-TS pass (4): drop the last non-null assertions + clean scan

**Build:** `bun test` 629 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green. Pure
refactor — no behavior change, no API change.

### What shipped

- **`ProvBundle.unifiedRecords` no longer uses `records[0]!` / `records[i]!`** — rewritten with
  `const [first, ...rest] = records` + `for (const record of rest)`. `rest.length === 0` is the exact
  equivalent of the old `records.length > 1` guard, so behavior is identical, and the indexed access
  (which `noUncheckedIndexedAccess` was forcing the `!` on) is gone. **Zero non-null assertions remain
  in non-test `src/`.**

### Scan results (this pass was mostly verification that the surface is already clean)

Swept `literal.ts`, `datetime.ts`, and the broader tree for the remaining smell classes:
- **No raw-`string` known-sets** left to unionize — `Literal.langtag` (open BCP-47) and the
  `xsd:dateTime` lexical strings are genuinely open sets; the datatype parser map is correctly
  string-keyed by `.uri` (per the value-equality invariant). `ProvFormat` (entry 18) was the only
  finite one.
- **No `.forEach`** (already `for…of`), **no stray `let`** (all are real reassignments), **no
  mutable-internal-array leaks** in the getters spot-checked.

### Still open (needs an isolated session — do NOT cram into a 10-min loop tick)

- **`newRecord` builder casts** (`as ProvEntity`/… across ~18 builders). Sound removal needs a
  type-level QName→class link: brand the record-type constants in `constants.ts` as
  `RecordTypeQName<ProvEntity>` (phantom field) and make `newRecord` generic over the brand, collapsing
  ~18 call-site casts into one justified internal `as T`. Touches `constants.ts` + 18 `import type`s +
  variance-sensitive inference — verify thoroughly in isolation. The lateral `newRecord<T>()` type-arg
  alternative just moves the assertion; prefer the branded version because it makes the link *checked*.
- **`EntityRef`/`ActivityRef`/`AgentRef`** are still bare aliases (`ProvRecord | QualifiedNameCandidate`)
  — a branded-ref refinement to enforce entity-vs-activity distinctness is a separate DX project.

> **Loop note:** `/loop @loop.md`, stop past **15:00**. Four passes this session (entries 18–21). The
> cron re-fires every 10 min and self-stops after 15:00. The codebase is now substantially more
> idiomatic; the two open items above are the only material ones left and both want a focused session.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 20 — idiomatic-TS pass (3): generic `getRecords(class)` filter (restores parity)

**Build:** `bun test` 629 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green · the
overloads verified in `dist/bundle.d.ts`. Additive (no behavior change for existing no-arg callers),
and it **restores** a Python feature that was deferred — so it's parity-positive, not a deviation.

### What shipped

- **`getRecords()` now accepts an optional class filter** (`model.py:1514-1530`,
  `isinstance(rec, class_or_type_or_tuple)`), which the TS port had stubbed as a no-arg method
  ("Type-filtered variant: a future addition"). Two overloads:
  ```ts
  getRecords(): ProvRecord[];
  getRecords<C extends RecordClass>(filter: C | readonly C[]): RecordInstance<C>[];
  ```
  `bundle.getRecords(ProvEntity)` → `ProvEntity[]`, `getRecords(ProvElement)` → all elements,
  `getRecords([ProvEntity, ProvAgent])` → `(ProvEntity | ProvAgent)[]`. The narrowing is **sound**:
  the implementation filters with `instanceof`, so the result genuinely *is* the narrowed type — no
  asserted cast (unlike the `newRecord` builder casts, still open below).
- **New exported types** `RecordClass<T>` (`abstract new (...args: any[]) => T` — abstract so
  `ProvElement`/`ProvRelation` work as filters; the `any[]` is justified inline since the ctor is only
  `instanceof`-tested, never invoked) and `RecordInstance<C>` (`C extends RecordClass<infer T> ? T :
  never`). `RecordInstance` **distributes** over a union, which is what makes the heterogeneous-array
  overload infer the *union* of instance types instead of collapsing to the first element's type
  (the bug a naïve `RecordClass<T>[]` signature hit — fixed by inferring over the constructor `C`).
- 5 tests in `bundle.test.ts`: no-filter count, single-class narrowing, abstract-base matches
  subclasses, array union filter, empty result.

### Punch-list for the next idiomatic pass

- **`newRecord` builder casts** (`bundle.ts` element + 15 relation builders — `as ProvEntity`, …):
  unlike `getRecords`, these can't be made sound without a type-level QName→class link. Options, both
  more invasive than a quick pass: (a) brand the record-type QName constants in `constants.ts`
  (`PROV_ENTITY: RecordTypeQName<ProvEntity>`) and make `newRecord` generic over the brand — moves the
  casts to one site each; (b) a generic `newRecord<T>` type-arg — lateral (`as` → caller-asserted
  `<T>`), not clearly better. Recommend (a), in isolation, since it makes the link *checked*.
- **`bundle.ts` non-null assertions** (`records[0]!`, `records[i]!` in `unifiedRecords`) — guarded by
  a length check; optional cleanup.
- **Raw-`string` known-sets** in `literal.ts`/`datetime.ts` — re-scan for union/branded opportunities.
- **Leave alone**: `equals(other: unknown)`, `isBundle()`/`hasBundles()` booleans,
  `(this.constructor as typeof ProvRecord)` static polymorphism.

> **Loop note:** `/loop @loop.md`, stop condition "clock past **15:00**". Three passes this session
> (entries 18–20). The cron re-fires `@loop.md` every 10 min and self-stops (cancels its job) on the
> first iteration past 15:00.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 19 — idiomatic-TS pass (2): `is*()` type-guard narrowing + a cast removed

**Build:** `bun test` 624 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green · the
predicate signatures verified in `dist/**/*.d.ts`. **No behavior change** (same booleans returned),
so no `DEVIATIONS` entry.

### What shipped

- **`isElement()` / `isRelation()` / `isDocument()` are now TS type predicates** —
  `isElement(): this is ProvElement`, `isRelation(): this is ProvRelation`,
  `isDocument(): this is ProvDocument` (on the `ProvRecord` / `ProvBundle` bases, plus the
  `ProvElement` / `ProvRelation` / `ProvDocument` overrides). Consumers (and our own internal call
  sites) now get **call-site narrowing** instead of a bare `boolean`.
- **`isBundle()` deliberately stays `boolean`** — `ProvDocument` *extends* `ProvBundle` yet
  `is_bundle()` returns `false` (`model.py:2549`), so a structural `this is ProvBundle` predicate
  would be unsound (an empty/any document *is* a `ProvBundle`). Same reasoning kept `hasBundles()` a
  boolean. Both are flagged inline so a later pass doesn't "fix" them into broken guards.
- **Cycle-free wiring:** `record.ts` type-imports `ProvElement`/`ProvRelation`; `bundle.ts`
  type-imports `ProvDocument`. All `import type` (erased), so no runtime edge is added to the modules
  that value-import these bases.
- **`document.ts:update` cast removed** — `(other as ProvDocument).bundles` became
  `if (other.isDocument() && other.hasBundles()) { … other.bundles … }`, the **same idiom already at
  `bundle.ts:421`**. Keeps Python's exact `has_bundles()` guard while the `isDocument()` narrows away
  the cast. Zero `as ProvDocument` casts remain in `src/`.
- **Honest test fixtures:** `record.test.ts`'s `TestEntity`/`TestActivity`/`TestGeneration` used to
  `extends ProvRecord` and hand-override `isElement`/`isRelation` to return `true` — a lie the old
  `boolean` return hid. The predicate exposed it (`tsc` rejected the sibling override), so they now
  `extends ProvElement` / `ProvRelation` for real and inherit the genuine guards. (`TestGeneration`
  takes a `null` id in one test — fine, relations permit null ids; elements don't.)
- **Compile-time narrowing tests** (`fluent.test.ts`, +2): each branch assigns the guarded value to
  the narrowed type (`const el: ProvElement = rec`) and reaches a subclass-only member
  (`doc.bundles`); these compile **only** while the guards narrow, so `tsc` is the regression assert.

### Punch-list for the next idiomatic pass (scanned)

- **`newRecord` builder casts** (`bundle.ts:450/468/481` — `as ProvEntity`/`ProvActivity`/`ProvAgent`):
  `newRecord` returns `ProvRecord`, so the element builders cast. A typed `newRecord` overload set (or
  a generic keyed by the type QName → concrete class) would drop these casts — medium effort, real DX
  win; do it in isolation.
- **`bundle.ts:390/392` non-null assertions** (`records[0]!`, `records[i]!`) under
  `noUncheckedIndexedAccess` — guarded by a length check; a small refactor (iterate with a
  `for…of` + first-seen accumulator) removes the `!`. Low value, optional.
- **Raw-`string` known-sets**: re-scan `literal.ts` / `datetime.ts` for datatype/format strings that
  could be unions or branded types. `QNameString` already exists; check for more.
- **Leave alone** (not smells): `equals(other: unknown)` (CLAUDE.md blesses it), `isBundle()` /
  `hasBundles()` booleans (sound-guard impossible), `(this.constructor as typeof ProvRecord)` static
  polymorphism.

> **Loop note:** running under `/loop @loop.md`; current stop condition is "clock past **15:00**".
> Two passes done this session (entries 18–19). The cron re-fires `@loop.md` every 10 min and will
> self-stop (cancel its job) on the first iteration that observes the clock past 15:00.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 18 — idiomatic-TS pass (1): `ProvFormat` union for serializer format names

**Build:** `bun test` 622 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green ·
`ProvFormat` verified present in the published `dist/*.d.ts`.

> New track (post-v1): **make the surface more idiomatic TypeScript without changing behavior,
> breaking tests, or losing Python feature-parity.** Each pass is one focused, fully-verified
> refinement so the change stays reviewable and the corpus oracle keeps gating it.

### What shipped

- **`ProvFormat` / `BuiltinProvFormat` string-literal union** (`src/serializers/serializer.ts`).
  Replaces the raw `format: string` on the format-dispatch surface so the two formats that ship
  today autocomplete at the call site (`doc.serialize("…")` → `"json"` | `"provn"`), satisfying
  CLAUDE.md's "never a raw `string` for a known value set". The serializer registry is genuinely
  **open** (optional PROV-XML/PROV-RDF subpath modules and third-party code register their own
  names), so the type is `BuiltinProvFormat | (string & {})` — the `string & {}` keeps the literal
  members visible in completions while still accepting any string (a bare `string` in the union
  collapses the whole type back to `string` and kills the hints). **No behavior change**: every
  string the registry accepted before is still accepted; this is additive type-narrowing only, so
  no `DEVIATIONS` entry.
- Applied to `ProvDocument.serialize` / `.deserialize`, `read()`, `getSerializer`,
  `registerSerializer`, `registeredFormats()`; `ProvFormat` + `BuiltinProvFormat` exported from
  `index.ts`. `registeredFormats(): ProvFormat[]` flows cleanly back into `read()`'s probe loop.

### Punch-list for the next idiomatic pass (scanned, not yet done)

- **`isElement()`/`isRelation()`/`isDocument()`/`isBundle()` return `boolean`** — TS **type-predicate
  guards** (`isElement(): this is ProvElement`) would give call-site narrowing. *Caution:* these are
  `override`s across the `ProvRecord`/`ProvBundle` hierarchy under `noImplicitOverride`; a base
  declaring `boolean` and a subclass narrowing to a predicate can conflict — verify the override
  signatures line up (likely declare the predicate on the base) before committing. More invasive
  than this pass; do it in isolation with the full suite.
- **Leave the `equals(other: unknown)` signatures** — CLAUDE.md explicitly blesses them; not a smell.
- `error.ts:27` `qname: unknown` holds an arbitrary invalid-qname candidate — justified; low priority.
- Re-scan for other raw-`string` known-sets and unnecessary `as` casts each pass.

> **Loop note:** this pass ran under `/loop @loop.md`, whose stop condition is "stop when the clock
> passes 13:00". The clock crossed 13:00 during this iteration, so the session loop was stopped
> (cron job cancelled) after this entry. Resume the punch-list above in a fresh run.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 17 — M6 polish: `.d.ts` strip-internal + consumer typecheck

**Build:** `bun test` 622 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`stripInternal: true`** in `tsconfig.build.json` — the two `@internal` mutation methods
  (`_setNamespaceParent`, `_attachToDocument` on `ProvBundle`) are now removed from the published
  `dist/*.d.ts`. Verified: zero references in the declarations; the public surface
  (`addBundle`/`unified`/`update`) is intact.
- **Consumer-side typecheck** — a throwaway consumer (`import { ProvDocument, read, Literal, XSD_INT,
  PROV_ENTITY, type ProvEntity } from "<dist>"` + the fluent API + `equals`) typechecks cleanly against
  the built `.d.ts` under **both** `moduleResolution: "bundler"` and `"nodenext"`. The dual ESM/CJS
  *runtime* imports were already smoke-tested across earlier iterations; this confirms the *types*
  consume cleanly too.

### Project status — v1 scope complete

M0–M6 are all done and verified: the full PROV-DM model, the fluent authoring API (containers +
records), PROV-JSON (round-trip, 398/398 corpus oracle GREEN), byte-exact PROV-N serialize, `read()`,
value-equality, all container transformations, dual ESM+CJS with curated, consumer-clean `.d.ts`,
`dependencies: {luxon}` only. Publishing is a human decision.

### Remaining (all post-v1)

- **PROV-N byte-differential** (optional hardening): export deterministic example docs from Python with
  a frozen clock; assert `getProvN()` byte-equality. Watch the multi-valued-attribute ordering (D9) —
  TS is insertion-ordered, Python set-ordered, so byte-equality may need order-normalization there.
- **M7** CLI (`prov-convert`/`prov-compare`), **M8** graph/dot, **M9** PROV-XML/PROV-RDF — each behind
  optional subpath exports + optional peer deps (`02-migration-roadmap.md` §3/§8, `03` §4).

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 16 — M4 tail: `unified` / `update` / `addBundle` (M4 fully complete)

**Build:** `bun test` 622 pass / 0 fail (corpus still 398/398) · `tsc --noEmit` clean · `bun run build`
green.

### What shipped

- **`ProvBundle`** — `unifiedRecords()` (merges same-identifier records via `record.copy()` +
  `addAttributes`, `model.py:1649`), `unified()` (new bundle of the merged records), `update(other)`
  (appends another bundle's records; rejects a document-with-sub-bundles).
- **`ProvDocument`** — `addBundle(bundle, id?)` (converts a nested-bundle-free document to a plain
  bundle, links namespaces, rewrites the id, stores), `update(other)` (records + same-id bundle merge
  via `self.bundle()`), `unified()` (override returning a `ProvDocument`, sharing the NS manager).
- **Immutability relaxed minimally**: `ProvBundle._identifier`/`_document`/`_namespaces` and
  `NamespaceManager.parent` are now mutable (`addBundle`/`unified` need it). TS forbids a subclass
  touching a base instance's protected fields, so `addBundle` goes through two `@internal` methods on
  `ProvBundle` (`_setNamespaceParent`, `_attachToDocument`).
- **DEVIATIONS** D10 (`unified` shares the NS manager) and D11 (`flattened` returns `this`) logged.
- `transformations.test.ts` (7 tests): bundle/document unify + merge, update record/bundle merge,
  addBundle + duplicate guard.

### M4 is now fully complete

Every container operation from `model.py:1127-2838` is ported: `NamespaceManager`, `ProvBundle` (full
builder API + `equals`/`getProvN`/`unified`/`update`), `ProvDocument` (sub-bundles, `flattened`,
`unified`, `update`, `addBundle`, serialize/deserialize dispatch).

### Recommended next item (post-v1-friendly)

- **PROV-N byte-differential** (strengthen M5's text oracle): export the deterministic example/statement
  docs from Python with a frozen clock; assert TS `getProvN()` byte-equals them across the
  `%g`/`%i`/multiline cases. Most of the `getProvN` machinery is already corpus-exercised indirectly.
- **Consumer-tsconfig snapshot**: typecheck the `.d.ts` under `node16` + `bundler`; freeze an API
  snapshot. (`@internal` methods like `_setNamespaceParent` would ideally be stripped via
  `stripInternal` in the declaration build — a small `tsconfig.build.json` tweak.)
- **Post-v1 milestones**: M7 CLI (`prov-convert`/`prov-compare`), M8 graph/dot, M9 PROV-XML/PROV-RDF —
  all gated behind optional subpath exports (`02-migration-roadmap.md` §3, §8).

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 15 — M6: v1 release prep (README, CHANGELOG, API curation)

**Build:** `bun test` 615 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`README.md`** — full rewrite for the PROV library: features, install, quick-start (author → fluent
  → serialize → read), bundles, typed literals, scope. (Replaced the leftover `greet` scaffold doc.)
- **`CHANGELOG.md`** — Keep-a-Changelog format; the unreleased v1 core entry.
- **`package.json` metadata** — `description`, `keywords`, `license: Apache-2.0` (matches the LICENSE
  file), `repository`/`homepage`/`bugs` pointing at `inflexa-ai/tsprov`.
- **Public-API curation** — replaced `export * from "./constants"` with an explicit allow-list of the
  ~87 public constants (namespaces, type/subtype/attr QNames, XSD datatypes); the **10 internal wiring
  maps** (`PROV_N_MAP`, `PROV_BASE_CLS`, `PROV_RECORD_IDS_MAP`, the id maps, the attribute sets) are no
  longer exported. Verified: `dist/index.d.ts` exports `PROV_ENTITY`/`ProvDocument`/`read` but has
  **zero** references to the internal maps.

### v1 core is release-ready

The published surface: `ProvDocument`/`ProvBundle` + the record classes, the fluent authoring API,
PROV-JSON (round-trip, corpus-validated) + PROV-N (serialize), `read()`, value-equality, and the public
constants — dual ESM+CJS with `.d.ts`, `dependencies: {luxon}` only. (Publishing itself — `npm version`
+ `npm publish` — is a human decision; `prepublishOnly` runs the build.)

### Recommended next item (all post-v1-friendly)

- **Deferred container ops**: `ProvBundle.update`/`unified`, `ProvDocument.add_bundle`/`update`/
  `unified` — relax the bundle's `_identifier`/`_document`/NS-parent immutability to implement.
- **PROV-N byte-differential**: export the deterministic example docs from Python (frozen clock) and
  assert TS `getProvN()` byte-equals them across the `%g`/`%i`/multiline cases.
- **Consumer-tsconfig snapshot**: typecheck the `.d.ts` under `moduleResolution: node16` + `bundler`,
  freeze an API-surface snapshot (the dist ESM/CJS runtime imports are already smoke-tested).
- Then the **post-v1 milestones** (M7 CLI, M8 graph/dot, M9 XML/RDF) per `02-migration-roadmap.md`.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 14 — M4 tail + M6: fluent record methods + `read()`

**Build:** `bun test` 615 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green · dist
smoke-tested (fluent chain + `read`).

### What shipped

- **Element fluent methods** (`model.py:670-922`, `:1006`) on `ProvEntity` / `ProvActivity` /
  `ProvAgent` — `e.wasGeneratedBy(a).wasAttributedTo(ag)`, `a.used(e).wasAssociatedWith(ag)`,
  `ag.actedOnBehalfOf(boss)`, etc. Each delegates to the bundle builder with `this` as the first formal
  arg and returns `this` for chaining. `this._bundle` (typed `RecordBundle`) is cast to `ProvBundle`
  (a type-only import — no runtime cycle, since `bundle.ts` value-loads `element.ts`, not vice versa).
  This un-defers the DX centerpiece from M4.
- **`src/read.ts`** — `read(content, format?)`: with a format, delegates to `ProvDocument.deserialize`;
  without, probes each registered serializer (PROV-N throws → skipped; JSON parses) and throws
  `TypeError` if none match (`__init__.py:23`). File/URL loading stays the caller's job
  (`read(await Bun.file(path).text())`).
- **`index.ts`** exports `read`.
- Tests: `fluent.test.ts` (fluent ≡ builder via `.equals()`, chaining returns `this`, relation types)
  and `read.test.ts` (auto-detect, explicit format, unparseable → `TypeError`).

### Status — feature-complete for v1

The public authoring + I/O surface is complete: fluent builders on both the container
(`doc.wasGeneratedBy(e, a)`) and the records (`e.wasGeneratedBy(a)`), PROV-JSON round-trip
(corpus-validated), PROV-N serialize (byte-exact), and `read()`/`serialize()`.

### Recommended next item — M6 finish (v1 release prep)

- **Public-API freeze**: review the `index.ts` surface; curate the `export *` from `constants.ts` (it
  leaks internal wiring maps — entry 2's note); record the frozen surface.
- **Consumer-tsconfig check**: typecheck the built `.d.ts` under both `moduleResolution: node16` and
  `bundler`; throwaway ESM + CJS import smoke (mostly covered by the dist smoke tests).
- **README + CHANGELOG**, `package.json` metadata (description, keywords, repository), confirm
  `dependencies: {luxon}` only.
- Optionally (post-v1-friendly): the deferred `add_bundle`/`update`/`unified` (relax bundle
  immutability) and the PROV-N byte-differential.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 13 — M5 main: PROV-JSON serializer + 398-file corpus oracle GREEN

**Build:** `bun test` **607 pass / 0 fail** (incl. all **398 corpus files**) · `tsc --noEmit` clean ·
`bun run build` green · dist round-trip smoke-tested.

### 🎉 The corpus oracle passes

`src/serializers/json.ts` (port of `provjson.py`) round-trips **every one of the 398
`reference/.../tests/json/*.json` fixtures**: `deserialize → serialize → deserialize` then `.equals()`
holds for all of them. This is the **primary M5 gate** and the first full validation of the
value-equality machinery (the #1 project risk) against the real Python corpus — QName/Literal/record
keys, the attribute store, namespace resolution, the builders, and equality all proven correct
end-to-end.

### What shipped

- **`src/serializers/json.ts`** — `ProvJsonSerializer`:
  - `encodeJsonDocument`/`encodeJsonContainer` with the **singleton-or-list collapse** (`provjson.py:178`)
    and `AnonymousIDGenerator` (keyed by `record.key`, so equal blank records share an anon id).
  - `decodeJsonDocument`/`decodeJsonContainer`/`decodeRecord` with the **membership HACK** (a multi-entity
    membership fans out, `provjson.py:244`) and the typed-literal `decodeJsonRepresentation`.
  - **Never mutates the parsed input** (destructures `{bundle, ...}` / `{prefix, ...}` instead of
    Python's `del`). Sub-bundles decode via `document.bundle(id)` (sidestepping the deferred `add_bundle`).
  - Self-registers as `"json"`; **value-exported from `index.ts`** (the bundling lesson from entry 12).
- **`ProvRecord.attributeEntries()`** — attributes grouped by name (the encoder needs the equivalent of
  `record._attributes.items()`).
- `json.test.ts`: 3 basics + the 398-file corpus oracle.

### Notes

- The int/double collapse (D5) and datetime precision (D2/D3) do **not** break the round-trip oracle:
  it tests self-consistency (decode→encode→decode stable), and the collapse is deterministic, so `doc`
  and `doc2` lose the same information identically and remain `.equals()`. (A byte-level *differential*
  against Python's exact JSON output is a separate, harder test, deferred.)
- Added `ProvJSONException`.

### Recommended next item — choose one

- **M6 (v1 release)**: `read()` format auto-detect (JSON/PROV-N), public-API freeze, dual-build
  verification under a consumer tsconfig, README/CHANGELOG. The core (model + PROV-JSON + PROV-N) is now
  functionally complete and corpus-validated — **v1 is within reach.**
- **PROV-N differential** (finish M5's text oracle): export the deterministic example/statement docs from
  Python with a frozen clock and assert TS `getProvN()` byte-equals them (the `%g`/`%i`/multiline cases).
- **M4 tail**: un-defer the element/relation fluent record methods (`e.wasGeneratedBy(a)`), and
  `add_bundle`/`update`/`unified` (relax bundle immutability).

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 12 — M5 start: container `getProvN` + PROV-N serializer

**Build:** `bun test` 205 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green · ESM+CJS dist
smoke-tested.

### What shipped

- **`ProvBundle.getProvN(indentLevel)`** (`model.py:1576`) — the `document … endDocument` /
  `bundle <id> … endBundle` framing with default/prefix declarations, records, and nested bundles.
  Sub-bundle rendering goes through a `subBundleProvN` hook that `ProvDocument` overrides (avoids a
  bundle→document import cycle). **Byte-for-byte equal to Python `get_provn`** (document + nested bundle,
  verified against the reference interpreter).
- **`src/serializers/serializer.ts`** — the `Serializer` interface + a `Map`-backed registry
  (`registerSerializer`/`getSerializer`/`registeredFormats`), `DoNotExist` (unknown format) and
  `UnsupportedOperationError` (serialize-only).
- **`src/serializers/provn.ts`** — `ProvNSerializer`: `serialize` → `doc.getProvN()`; `deserialize`
  throws `UnsupportedOperationError`. Self-registers as `"provn"`.
- **`ProvDocument.serialize(format)`** + static **`deserialize(input, format)`** dispatch through the
  registry.
- `provn.test.ts` (8 tests): byte-exact document & nested-bundle PROV-N, serialize delegation,
  unsupported deserialize, registry lookup + `DoNotExist`.

### Bundling lesson (carry into the JSON serializer)

`sideEffects: false` makes the bundler **drop bare side-effect imports** — `document.ts`'s
`import "./serializers/provn"` registered provn in `bun test` but was dropped from the built bundle, so
`serialize("provn")` threw `DoNotExist` in dist. **Fix:** value-export the serializer
(`export { ProvNSerializer } from "./serializers/provn"`) from `index.ts` so its module — and its
`registerSerializer` call — is included. Verified in both ESM and CJS dist. **The JSON serializer must
be value-exported the same way.**

### Recommended next item — the PROV-JSON serializer + the corpus oracle (M5 main)

- **`src/serializers/json.ts`** — `ProvJsonSerializer` (`provjson.py`, 340 lines): `encodeJsonDocument`
  (records → the PROV-JSON object shape; the **singleton-or-list collapse** when an id repeats,
  `provjson.py:178`) and `decodeJsonDocument` (the inverse + the **membership HACK** fan-out,
  `provjson.py:244`; `AnonymousIDGenerator`; `literalJsonRepresentation` for typed values / datetimes /
  QNames / langtags). **Never mutate the parsed input** (Python `del`s keys; copy first). Self-registers
  as `"json"`; **value-export `ProvJsonSerializer` from `index.ts`**.
- Then the **corpus oracle**: a test that loads each of the 398 `reference/.../tests/json/*.json` files,
  `deserialize`s, re-`serialize`s, `deserialize`s again, and asserts `.equals()` on the two parsed docs
  (timestamp-safe, `04 §10`). The primary M5 gate and the first full validation of the value-equality
  machinery against the real Python corpus. Start with a handful of files, then run all 398.
- Watch for: int-vs-double (D5), datetime offset/precision (D2/D3), and the prov:type-as-QName-vs-string
  question when decoding typed literals.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 11 — M4 step 3: `ProvDocument`

**Build:** `bun test` 199 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green · dist
smoke-tested.

### What shipped

- **`src/document.ts`** — `ProvDocument extends ProvBundle` (`model.py:2500`): a sub-bundle map,
  `bundle(identifier)` (creates a named child whose NamespaceManager parent is the document's, so
  child bundles inherit the document's namespaces), `bundles`/`hasBundles`, `isDocument`→true,
  document-level **`equals`** (bundle-set equality on top of `ProvBundle.equals`, `model.py:2523`), and
  **`flattened`** (lifts bundle records to the document level; returns `this` unchanged with no bundles
  — the documented quirk).
- **`index.ts`** exports `ProvDocument`.
- `document.test.ts` (16 tests): document vs bundle, inherited builders, child-bundle creation +
  namespace inheritance, the duplicate-id guard, flatten (identity + record-lift), document equality.

### Important fix — registry population via side-effect imports

`bundle.ts` referenced the concrete record classes only as **types** (return annotations + `as` casts),
so importing `ProvBundle`/`ProvDocument` alone never loaded `element.ts`/`relation.ts` → the registry
was empty → `newRecord` threw "No record class for type …". (It only worked before because the bundle
*test* value-imported the classes.) **Fix:** bare side-effect imports
`import "./record/element"; import "./record/relation";` at the top of `bundle.ts` — never elided
(bun/tsc keep them), so the registry is always populated wherever the bundle is used. Verified in
`bun test` and the built dist bundle. **Lesson for M5:** any module that calls `newRecord`/uses the
registry must transitively load the class modules.

### Deferred (to finish M4)

- **Element/relation fluent record methods** (`e.wasGeneratedBy(a)`, `a.used(e)`, `ag.actedOnBehalfOf`):
  delegate to `this._bundle.<builder>(this, …)`. Needs `this._bundle` widened from `RecordBundle` to a
  type exposing the builders (add the builder signatures to a `BundleApi` interface that `RecordBundle`
  extends, or cast). Small but touches `record.ts` typing.
- **`add_bundle`/`update`/`unified`** — require mutating a bundle's `_identifier` / NS-manager `parent` /
  `_document`; the current immutable design doesn't expose these. Relax immutability (mutable-protected)
  when these land.

### Recommended next item — M5: serializers (PROV-JSON + PROV-N), the corpus oracle

1. **`src/serializers/serializer.ts`** — the `Serializer` interface + a `Map`-backed registry
   (`registerSerializer`/`getSerializer`, throwing `DoNotExist` on unknown format) — `04 §7.1`.
2. **`src/serializers/provn.ts`** — trivial: `serialize` delegates to a document/bundle `getProvN`
   (which needs the container `get_provn` wrapper — `model.py:1595`, the `document`/`endDocument` and
   `bundle`/`endBundle` framing, indentation); `deserialize` throws a `NotImplementedError`-equivalent.
3. **`src/serializers/json.ts`** — `encode/decodeJsonDocument` (`provjson.py`): the singleton-or-list
   collapse (`provjson.py:178`), the membership HACK (`provjson.py:244`), `AnonymousIDGenerator`,
   `literalJsonRepresentation`. **Never mutate inputs.**
4. Wire `ProvDocument.serialize(format)`/`deserialize` to the registry; then run the **398-file
   `reference/.../tests/json/` corpus** as the round-trip oracle
   (`deserialize → serialize → deserialize` then `.equals()`) — the primary M5 gate. This is where the
   value-equality machinery built across M1–M4 gets validated against the real Python corpus.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 10 — M4 step 2: `ProvBundle` + the fluent builder API

**Build:** `bun test` 188 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`src/bundle.ts`** — `ProvBundle` (`model.py:1373`), the DX centerpiece:
  - **Implements `RecordBundle`** — `validQualifiedName`/`mandatoryValidQname` delegate to its
    `NamespaceManager`. This finally closes the M3 record seam: records resolve string attr-names for
    real now.
  - `newRecord`/`addRecord`/`addRecordInternal`, `getRecord`/`getRecords`, `addNamespace` (Namespace or
    prefix+uri overload), `setDefaultNamespace`, `isBundle`/`isDocument`/`hasBundles`.
  - **`equals`** — set-equality of records by canonical `record.key` (`model.py:1619`),
    order-independent.
  - **All 18 fluent builders** — `entity`/`activity`/`agent`/`collection` + 14 relations, with the
    **camelCase PROV names primary** (`wasGeneratedBy`, `wasDerivedFrom`, `specializationOf`, …) and the
    descriptive names (`generation`, `derivation`, …) as aliases (DEVIATIONS: naming inversion). The
    subtype builders (`wasRevisionOf`/`wasQuotedFrom`/`hadPrimarySource`/`collection`) build the base
    class + `addAssertedType`.
  - Builders accept **record refs or string ids**; the ergonomic object-attribute form
    (`{ "ex:role": "author" }`) resolves string keys through the bundle.
- **`record.ts`** — broadened `ProvAttributes` to accept `ProvRecord` refs + `null`/`undefined` (skipped),
  exported `normalizeAttributes`, added the `AttributeValue` type.
- **`index.ts`** exports `ProvBundle` + the ref types.
- `bundle.test.ts` (13 tests): the end-to-end author→PROV-N path, no-time placeholders, refs & string
  ids, the object form, lookup, alias delegation, subtype builders, and order-independent equality.

### Notes / deferred

- **Element/relation fluent record methods** (`e.wasGeneratedBy(a)`) are still deferred — they delegate
  to the bundle builders. Un-defer in a small follow-up (one-liners on the record classes calling
  `this._bundle.<builder>(this, …)`; note `this._bundle` is typed `RecordBundle` — widen to `ProvBundle`
  or add the builder methods to the `RecordBundle` interface).
- **Typed refs** are aliases (`EntityRef = ProvRecord | QualifiedNameCandidate`) — document intent but
  don't yet enforce entity-vs-activity distinctness (a branded-ref refinement, later).
- `getRecords` type-filtering and `unified`/`flattened`/`update` deferred.

### Recommended next item — M4 step 3: `src/document.ts` (`ProvDocument`)

- `ProvDocument extends ProvBundle`: a `bundles` map, `bundle(identifier)` (creates a child bundle with
  `this` as the parent document → links namespace managers), `addBundle`, `hasBundles`/`bundles`,
  `isDocument` → true.
- **`equals`** layers bundle-set equality on top of `ProvBundle.equals` (`model.py:2523`).
- `flattened`/`unified`/`update` (the copy-vs-mutate quirks — `flattened` may return `this`; `unified`
  shares the NS manager — DEVIATIONS). Defer `serialize`/`deserialize` dispatch to M5 (no serializers
  yet).
- Then **un-defer the fluent record methods**, and M4 is complete → **M5** (PROV-JSON + PROV-N
  serializers, the 398-file corpus oracle).

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 9 — M4 step 1: `NamespaceManager`

**Build:** `bun test` 175 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`src/namespace-manager.ts`** — `NamespaceManager` (`model.py:1127`), **composed** (not
  `dict`-subclassed): a `prefixes` map (seeded with prov/xsd/xsi) + the URI/rename side-maps (the ones
  Python keys on a `Namespace` object are keyed by `Namespace.key`).
  - **`addNamespace`** returns the *effective* namespace — URI dedup (same URI, new prefix → reuse) and
    prefix-conflict rename (`ex` → `ex_1`). Callers must use the return value.
  - **`validQualifiedName`** — the full precedence ladder: a `QualifiedName` re-homes its namespace
    (default-namespace `dn` synthesis; reference-identity vs equality distinction); a `prefix:local`
    string hits registered → renamed → URI-compaction; a bare string uses the default namespace; then
    the parent is consulted.
  - `setDefaultNamespace`/`getDefaultNamespace`, `getAnonymousIdentifier` (`_:id1`, …), `getNamespace`,
    `getRegisteredNamespaces`.
- **`index.ts`** exports `NamespaceManager`.
- `namespace-manager.test.ts` (19 tests): defaults, registration, URI dedup, prefix rename, the
  prefix:local / Identifier / blank-node / compaction / bare-name paths, the two-prefix-same-URI case,
  default-namespace adoption, sequential anon ids, and parent delegation.

### Recommended next item — M4 step 2: `src/bundle.ts` (`ProvBundle`, the big one)

- `ProvBundle` holds a `NamespaceManager`, an ordered `records` list, and an `idMap`
  (`identifier.uri` → records). **It implements `RecordBundle`** — wire `validQualifiedName` to the
  NamespaceManager and `mandatoryValidQname` to throw `ProvExceptionInvalidQualifiedName` on null.
- **`newRecord(type, id, attrs)`** (`model.py`): resolve the id, `getRecordClass(type)`, construct,
  `_add_record`. The fluent builders call this.
- **The fluent builder API** — `entity`/`activity`/`agent` + all 15 relation builders, with the
  **camelCase PROV names primary** and the descriptive names as aliases (DEVIATIONS: naming inversion,
  `model.py:2479-2497`). This **un-defers** the element/relation fluent methods
  (`e.wasGeneratedBy(...)` → delegate back to `this.bundle`).
- `getRecords`/`getRecord`, `equals` (record set-equality — bucket by `record.key`, the O(n) version in
  `04 §6`, `model.py:1619`), and the subtype builders (`revision`/`quotation`/`primarySource`/
  `collection` via `addAssertedType`).
- **Defer `unified`/`flattened`/`update`** to a focused follow-up if the iteration gets large — the
  builder API + equality is the core. Then **M4 step 3: `src/document.ts`** (`ProvDocument extends
  ProvBundle`).

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 8 — M3 step 5: registry + `copy()` (M3 COMPLETE)

**Build:** `bun test` 160 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green · **ESM+CJS
bundle smoke-tested** (registration survives bundling; `copy()` works).

### What shipped

- **`src/record/registry.ts`** — `PROV_REC_CLS` (`type.uri` → `RecordCtor`) + `registerRecordClass`
  / `getRecordClass` / `registeredRecordCount`. **Cycle-free**: imports only *types* from `record.ts`,
  so it is a dependency leaf.
- **Self-registration** — `element.ts`/`relation.ts` call `registerRecordClass` at module load (all
  18 classes). Verified the `sideEffects: false` bundle keeps these: a smoke test against built `dist`
  confirms `getRecordClass(PROV_ENTITY) === ProvEntity` and a working `copy()` in **both ESM and CJS**.
- **`ProvRecord.copy()`** (`model.py:300`) — clones a record via the registry.
- **`index.ts`** now exports the full record layer (ProvRecord, 3 elements, 15 relations, registry
  fns + types).
- `registry.test.ts` (4 tests): all 18 registered, type→ctor lookup, element/relation copy.

### M3 is complete

The whole record system — `format.ts` (incl. `%g`), `AttributeStore`, `ProvRecord`
(`addAttributes`, `equals`/`key`, `getProvN`), all 18 element/relation classes, the registry +
`copy()` — is done, tested (160 tests total), and verified in the built bundle. Value-equality (the
#1 project risk) is fully exercised.

### Recommended next item — M4: the container layer (`model.py:1127-2838`, the biggest milestone)

Build order:
1. **`src/namespace-manager.ts`** — `NamespaceManager` as composition over `Map<string,Namespace>` +
   the 4 side-maps; the `valid_qualified_name` precedence resolver; `add_namespace` (returns the
   *effective* namespace — callers MUST use the return value, `model.py:1203`);
   `get_anonymous_identifier`. **This finally implements the `RecordBundle` resolver for real** (the
   M3 seam), incl. the two-prefix and default-namespace edge cases (`tests/qnames.py`,
   `tests/attributes.py:4-5`).
2. **`src/bundle.ts`** — `ProvBundle`: `_records`/`_id_map`, `get_records`/`get_record`,
   `new_record`/`_add_record`, and the **fluent builder API** (all 18 builders + camelCase aliases —
   DEVIATIONS: camelCase becomes primary) which **un-defers** the element/relation fluent methods.
   Plus `equals` (record set-equality, `model.py:1619`), `unified`/`flattened`/`update`.
3. **`src/document.ts`** — `ProvDocument extends ProvBundle`: `_bundles`, `bundle`/`add_bundle`,
   `flattened`, `unified`, `serialize`/`deserialize` dispatch, `ProvDocument.__eq__`
   (`model.py:2523`).

`ProvBundle` implements `RecordBundle` (wire `validQualifiedName`/`mandatoryValidQname` to the
`NamespaceManager`). Drive with `tests/qnames.py` and the `primer_example == primer_example_alternate`
equality test (`tests/examples.py`) — the first real end-to-end exercise of value-equality.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 7 — M3 step 4: concrete elements & relations

**Build:** `bun test` 156 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`src/record/element.ts`** — `ProvElement` (abstract; throws `ProvElementIdentifierRequired` on a
  null id; `isElement()` → true) + `ProvEntity`, `ProvActivity`, `ProvAgent`. `ProvActivity` carries
  `FORMAL_ATTRIBUTES = [startTime, endTime]` and **`setTime`/`getStartTime`/`getEndTime`**.
- **`src/record/relation.ts`** — `ProvRelation` (abstract; `isRelation()` → true) + all **15**
  relation classes, each with `static prov_type` + `FORMAL_ATTRIBUTES` copied verbatim from
  `model.py`, plus `ProvMention extends ProvSpecialization` (`model.py:1079`).
- Added **`AttributeStore.set`** (replace-with-single-value) for `setTime`.
- Tests: `element.test.ts` + `relation.test.ts` (26 new) — the id requirement, isElement/isRelation,
  per-class prov_type/FORMAL_ATTRIBUTES (data-driven over all 15 relations), the
  Mention⊂Specialization chain, `setTime`, and `getProvN`.

### Decisions logged in DEVIATIONS.md

- **D8 `setTime` raw store** (`model.py:786`): stored un-coerced and replacing. Preserves a naive ISO
  string byte-for-byte (no luxon offset), which actually *helps* byte-parity (vs D3).
- **D9 `AttributeStore`** ordering + no read-mutation (promoted from "planned").

### TS note — static `FORMAL_ATTRIBUTES` on a subclass chain

`as const` froze `ProvSpecialization.FORMAL_ATTRIBUTES` to a 2-tuple, which `ProvMention` (3 attrs)
can't widen → static-side override error. Fix: annotate those two as `readonly QualifiedName[]` (no
`as const`). The 13 relations extending `ProvRelation` directly keep `as const` fine.

### Recommended next item — M3 step 5: `src/record/registry.ts` (completes the M3 record layer)

- `PROV_REC_CLS: Map<string, RecordCtor>` keyed by `qn.uri` + `registerRecordClass(qn, ctor)` +
  `getRecordClass(qn)`, where `RecordCtor = new (bundle, id, attrs?) => ProvRecord`.
- Register all 18 concrete classes. **Avoid an import cycle:** `registry.ts` must not runtime-import
  `record.ts` (use a type-only import); have `element.ts`/`relation.ts` (or a small `record/index.ts`)
  call `registerRecordClass` at module load.
- Wire **`ProvRecord.copy()`** (`model.py:300`):
  `new (getRecordClass(this.getType()))(this._bundle, this.identifier, this.attributes)`.
- After that, **M4 — containers**: `NamespaceManager`, `ProvBundle` (implements `RecordBundle` + the
  fluent builder API, which un-defers the element/relation fluent methods), `ProvDocument`. M4 is
  where string attribute-name resolution (the M3 seam) finally gets a real implementation.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 6 — M3 step 3: `ProvRecord` (`record.ts`)

**Build:** `bun test` 130 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`src/record/record.ts`** — the abstract `ProvRecord` base (`model.py:269-609`) on the
  `AttributeStore` + `valueKey`:
  - **`addAttributes`** — QName-valued vs literal-valued formal attrs; `autoLiteralConversion` (the 7
    in-table XSD types → native value, other typed Literals kept, matching `model.py:417`); and the
    **single-valued-formal rule** (`model.py:505-524`): repeated-equal ignored, conflicting throws
    `ProvException`, and the "non-comparable 2nd value = different" branch realized as a `valueKey`
    mismatch. `is_collection` lifts the rule.
  - **`equals` + `key`** via `valueKey` + the asymmetric blank-id rule (compare ids only when *this*
    has one; order-independent attribute multiset).
  - `attributes`/`formalAttributes`/`extraAttributes`/`args`, `getAssertedTypes`/`addAssertedType`,
    `label`/`value`, and **`getProvN`** (id placement, `-` placeholders, the `id; ` relation prefix,
    the `[name=value]` extra block via `provnRepresentation`/`encodingProvnValue`).
- **Bundle seam resolved cleanly:** `ProvRecord` depends only on a minimal **`RecordBundle`**
  resolver interface (`validQualifiedName`/`mandatoryValidQname`), which M4's `ProvBundle` will
  implement. M3 is not blocked on M4 — tests use a trivial identity resolver + concrete subclasses.
- **`record.test.ts`** — 17 tests: formal/extra split, single-valued rule (ignore/throw),
  datetime-formal parsing, asserted-type dedup, auto-conversion (typed Literal → native; unparseable
  kept as Literal), order-independent equality/key, and `getProvN` for elements and relations.

### Notes

- `record.ts` is **not** exported from `index.ts` yet — wait until the concrete classes + registry
  land (steps 4–5) and export the record layer as a unit.
- Static-member polymorphism works via `(this.constructor as typeof ProvRecord).prov_type` /
  `.FORMAL_ATTRIBUTES`; concrete subclasses use `static override readonly prov_type = …`.

### Recommended next item — M3 step 4: `element.ts` + `relation.ts` (the concrete classes)

- **`src/record/element.ts`** — abstract `ProvElement` (throws `ProvElementIdentifierRequired` on a
  null id; `isElement()` → true) + `ProvEntity`/`ProvActivity`/`ProvAgent`. `ProvActivity` has
  `FORMAL_ATTRIBUTES = [PROV_ATTR_STARTTIME, PROV_ATTR_ENDTIME]` and the `setTime` quirk
  (`model.py:802` stores the raw value → DEVIATIONS). The fluent helpers (`wasGeneratedBy`, …)
  delegate to the bundle's builder API (M4), so **defer the fluent methods** and land the classes +
  `static prov_type`/`FORMAL_ATTRIBUTES` now.
- **`src/record/relation.ts`** — abstract `ProvRelation` (`isRelation()` → true) + all 14 relation
  classes, each with its `FORMAL_ATTRIBUTES` and `prov_type`, plus
  `ProvMention extends ProvSpecialization` (`model.py:1079`). Pull each relation's formal-attribute
  list straight from the concrete class defs (`model.py:~660-1100`).
- Then **step 5: `src/record/registry.ts`** — `PROV_REC_CLS` as `Map<string, RecordCtor>` keyed by
  `qn.uri` + `registerRecordClass`; this enables `ProvRecord.copy()` (deferred until the registry
  exists).

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 5 — M3 steps 1–2: `format.ts` + `AttributeStore`

**Build:** `bun test` 113 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`src/format.ts`** — `formatFloatG` (C `%g`), `quoteMaybeMultiline` (lifted out of `literal.ts`,
  which now imports it), and `encodingProvnValue` (`model.py:132`). **`formatFloatG` is verified
  byte-for-byte against the reference Python `'%g' % x`** for 22 representative values + `inf`/
  `-inf`/`nan`/`-0` (algorithm: `%e` when the decimal exponent is `< -4` or `>= 6`, else `%f`; strip
  trailing zeros; signed ≥2-digit exponent). This was the flagged footgun — now pinned.
- **`src/record/attributes.ts`** — the `AttributeStore`: an insertion-ordered, `valueKey`-deduped
  multimap replacing `defaultdict(set)` (`model.py:293`). Two deliberate properties: **value dedup**
  by PROV equality, and **no read-mutation** (reads never create phantom empty entries, unlike the
  Python `defaultdict`). Deterministic ordering where Python `set`s were not.
- Tests: `format.test.ts` (22 golden `%g` + quoting + provn-value) and `attributes.test.ts` (dedup,
  ordering, no-read-mutation, `first`/`has`/`pairs`/`size`).

### Notes

- The `AttributeStore` insertion-ordering and no-read-mutation are the D-planned DEVIATIONS items —
  promote them in `DEVIATIONS.md` when `ProvRecord` lands (they're observable there).
- `format.ts` and `AttributeStore` are **not** exported from `index.ts` yet (internal); they become
  reachable through `ProvRecord`.

### Recommended next item — M3 step 3: `src/record/record.ts` (`ProvRecord`)

The central class, built on the `AttributeStore` + `valueKey`:
- Constructor `(bundle, identifier, attributes?)`; `getType()` reads the subclass's
  `static prov_type` via `(this.constructor as typeof ProvRecord)`; a `formalAttributesOrder`
  accessor reads `static FORMAL_ATTRIBUTES`.
- **`addAttributes(attrs)`** — the single-valued-formal rule (`model.py:505-524`): a 2nd value for a
  formal attr is ignored if equal, throws `ProvException` if different; the **non-comparable branch**
  (`model.py:514-516`) treats an incomparable 2nd value as different (→ throws). `is_collection`
  (presence of `PROV_ATTR_COLLECTION` among the incoming attrs) disables the check (`model.py:460`).
- `attributes` (= `store.pairs()`), `formalAttributes` (FORMAL_ATTRIBUTES order, `first` of each),
  `extraAttributes` (the rest); `getAssertedTypes`/`addAssertedType` over `PROV_TYPE`.
- **`equals` + `key`** via `valueKey` + the asymmetric blank-id rule (`model.py:528-536`): compare
  ids only when *this* has one. `key = type.uri ∥ id ∥ sorted(attr.uri ∥ valueKey)`.

> **Seam to plan for:** Python resolves string attribute names via
> `self._bundle.valid_qualified_name`. `NamespaceManager`/`Bundle` don't exist until M4, so for M3
> have `ProvRecord` accept **already-resolved `QualifiedName`s** (the tests can construct QNames
> directly) and defer the string→QName resolution path to M4. Don't block M3 on the container layer.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 4 — `error.ts` + `value.ts` (M2 complete; M3 head-start)

**Build:** `bun test` 72 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`src/error.ts`** — the exception hierarchy (`ProvError` ⊃ `ProvException` ⊃
  `ProvExceptionInvalidQualifiedName` / `ProvElementIdentifierRequired`) as native `Error`
  subclasses, plus the **warning callback** (`warn` / `setWarningHandler`, default `console.warn`)
  that resolves the `ProvWarning` open decision (`03 §3`). `literal.ts` now imports `warn` from
  here (its local stub removed). **This completes M2.**
- **`src/value.ts`** — the `AttrValue` union and **`valueKey`**, the type-tagged canonicalizer at
  the heart of all PROV value-equality (`04 §6`). Tags `L`/`Q`/`I`/`D`/`S`/`N`/`B`. A string and a
  same-URI QName get **different** keys (different Python types ⇒ different hashes), while
  different-prefix same-URI QNames and structurally-equal literals **dedup**. Built early per the
  roadmap's "land equality first" guidance, so the M3 record layer can lean on it.
- **`DEVIATIONS.md`** — created and back-filled with the 7 divergences so far (D1 qname
  memoization, D2 sub-ms datetime, D3 naive datetime, D4 ISO-only parse, D5 `String` vs `str`,
  D6 numeric-parse `null`, D7 warning callback) + a "planned" list for M3.
- **`index.ts`** now also exports the error classes, `setWarningHandler`, `valueKey`, `AttrValue`.

### Recommended next item — M3, the record layer (`model.py:269-1125`, the big one)

Build order within M3 (test each as it lands):
1. **`src/format.ts`** — lift `quoteMaybeMultiline` out of `literal.ts`; add `encodingProvnValue`
   and **`formatFloatG`** (the C `%g` footgun, `model.py:132-145`, `04 §7.4`). Unit-test `%g`
   against golden PROV-N strings (`datatypes`/`long_literals`).
2. **`src/record/attributes.ts`** — the `AttributeStore` (insertion-ordered, value-deduped via
   `valueKey`); replaces `defaultdict(set)` (`model.py:293`) **without** the read-mutation (→
   DEVIATIONS).
3. **`src/record/record.ts`** — `ProvRecord`: `add_attributes` with the single-valued-formal rule
   (`model.py:505-524`, including the non-comparable→different branch), the `attributes` /
   `formal_attributes` / `extra_attributes` views, `getProvN`, and `equals` + `key` (uses
   `valueKey`; the asymmetric blank-id rule `model.py:533`).
4. **`src/record/element.ts`** (Entity/Activity/Agent; throw `ProvElementIdentifierRequired` on a
   null id) and **`src/record/relation.ts`** (all 14 + `ProvMention ⊂ ProvSpecialization`), each
   declaring `static FORMAL_ATTRIBUTES` + `static prov_type`.
5. **`src/record/registry.ts`** — `PROV_REC_CLS` as `Map<string, RecordCtor>` keyed by `qn.uri` +
   `registerRecordClass`.

`valueKey` (done) is the function every one of these depends on for equality/dedup.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 3 — `datetime.ts` + `literal.ts` (M2)

**Build:** `bun test` 61 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.
**Dependency:** installed **luxon@3.7.2** (+ `@types/luxon`) — the first and, for the core, only
runtime dependency; pre-approved in `03-dependency-analysis.md`.

### What shipped

- **`src/datetime.ts`** — luxon facade: `ensureDateTime` (`model.py:65`), `parseXsdDateTime`
  (`model.py:72`, `null` on failure), `toXsdDateTime`, and the `DateLike` input type. Uses
  `DateTime.fromISO(s, { setZone: true })` to preserve the source UTC offset.
- **`src/literal.ts`** — `Literal{value, datatype?, langtag?}` with `equals`/`key`/
  `provnRepresentation`/`toString`; the langtag → `prov:InternationalizedString` forcing (warns on
  a conflicting datatype, `model.py:156-171`); `parseBoolean` (tri-state); the
  `XSD_DATATYPE_PARSERS` table (exactly the 7 Python entries — no `xsd:float`) + `parseXsdTypes`.
  Private `quoteMaybeMultiline` (triple-quote + escape) — **lift to a shared `format.ts` at M3**
  when the record/serializer layer needs it.
- **Tests:** `datetime.test.ts` + `literal.test.ts` (40 new). `index.ts` now exports `Literal` and
  the datetime facade.

### Decision — `toXsdDateTime` matches Python `isoformat()` (resolves the datetime open question, mostly)

I diffed luxon against the reference venv's `dateutil.parse(s).isoformat()`. luxon's `.toISO()`
differs (emits `Z` for UTC, always `.000` millis), so `toXsdDateTime` formats manually:
`yyyy-MM-dd'T'HH:mm:ss` + 6-digit microseconds **only when non-zero** + a `ZZ` offset (`+00:00`,
never `Z`). This is **byte-equal to Python** for every tz-aware case tested.

**Remaining gaps (flag for the M5 corpus differential):**
- **Sub-millisecond precision is lost** — luxon resolves to ms, so `...123456` → `...123000`.
  If the JSON corpus contains 6-digit microseconds that aren't ms-multiples, M5 must carry the raw
  lexical datetime string for such literals rather than reformatting.
- **Naive (offset-less) datetimes** get a zone assigned by luxon; Python keeps them naive. PROV
  data is normally tz-aware.
- **`String(value)` ≠ Python `str(value)`** for floats (`2.0` → `"2"`) and bools (`true` →
  `"true"` vs `"True"`). Harmless for the corpus *as long as the JSON decoder passes lexical
  strings* (it must) — only programmatic authoring with a bare JS number is affected (the
  int/double collapse from the risk register).

These three belong in `DEVIATIONS.md` (still uncreated — create it at M3 with the record layer's
first behavioral quirk and back-fill these).

### Recommended next item — `src/error.ts` (finishes M2), then the M3 record layer

- **`src/error.ts`**: the exception hierarchy — `ProvError` (base, was `prov.Error` in
  `__init__.py`), `ProvException` (`model.py:229`), `ProvExceptionInvalidQualifiedName`
  (`model.py:241`), `ProvElementIdentifierRequired` (`model.py:259`). Small, no dependents yet; it
  unblocks `ProvElement` (M3), which throws `ProvElementIdentifierRequired` on a null id. Resolve
  the `ProvWarning` question here too: per `03 §3`, emit via the `onWarning` callback (already
  stubbed as `TODO(extend)` in `literal.ts`), not a `Warning` subclass.
- Then **M3 — the record layer** (`src/record/{record,element,relation,attributes,registry}.ts`),
  the big one (`model.py:269-1125`). Start with `AttributeStore` + `ProvRecord.add_attributes`
  (the single-valued-formal rule, `model.py:505-524`) and the central **`valueKey`** function
  (`04 §6`), then the 3 element + 15 relation classes + the registry. `quoteMaybeMultiline` and a
  new `encodingProvnValue`/`formatFloatG` (`%g`, the footgun) land here as a shared `format.ts`.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 · entry 2 — `constants.ts` (M2)

**Build:** `bun test` 33 pass / 0 fail · `tsc --noEmit` clean · `bun run build` green.

### What shipped

- **`src/constants.ts`** — full port of `constants.py`: the `XSD`/`PROV`/`XSI` namespaces; all 19
  record-type QNames + 9 subtype QNames; all 23 QName-valued + 3 literal-valued formal attributes;
  the convenience QNames (`PROV_TYPE`, `PROV_LABEL`, `PROV_VALUE`, `PROV_LOCATION`, `PROV_ROLE`,
  `PROV_QUALIFIEDNAME`, `PROV_INTERNATIONALIZEDSTRING`); and all 23 XSD datatypes. Every constant
  is minted via interned `ns(...).qn(...)`, so they are process-global singletons.
- **Wiring maps, all string-keyed by `qn.uri`** (never object-keyed): `PROV_N_MAP`,
  `PROV_RECORD_IDS_MAP` (inverse), `ADDITIONAL_N_MAP`, `PROV_BASE_CLS`, `PROV_ATTRIBUTE_QNAMES`,
  `PROV_ATTRIBUTE_LITERALS`, `PROV_ATTRIBUTES`, `PROV_ID_ATTRIBUTES_MAP`, `PROV_ATTRIBUTES_ID_MAP`.
  Inverse/derived maps are built from a single source-of-truth pair array so the two directions
  cannot drift.
- **`src/constants.test.ts`** — 12 tests: URIs, singleton interning, map cardinalities
  (`PROV_N_MAP`=19, `ADDITIONAL_N_MAP`=9, `PROV_BASE_CLS`=28, attr qnames=23 / literals=3 / all=26),
  inverse-map round-trip, base-class collapse (Revision→Derivation, Plan→Entity), and the
  `prov:`-split the RDF serializer relies on.
- **`src/index.ts`** — now also `export * from "./constants"`. ⚠️ This leaks the internal wiring
  maps into the public surface; **curate the public exports at M6** (API freeze).

### Decision — canonical attribute order (resolves an `00-overview.md` open question)

Python's `PROV_ATTRIBUTES` is a `set` union and `PROV_RECORD_ATTRIBUTES` iterates it in
nondeterministic order. The port defines an explicit **`PROV_ATTRIBUTES_ORDER`** array (the 23
QName attrs in `constants.py:140` source order, then the 3 literal attrs) and derives every set
and id-map from it. The id maps are lookup tables (order doesn't affect their correctness), but
pinning the order removes ambiguity for any future consumer that iterates the attributes.

### Map-direction reference (verified against the serializers)

| Map | Key | Value | Source use |
|---|---|---|---|
| `PROV_N_MAP` | type `qn.uri` | PROV-N name | `model.py:589` |
| `PROV_RECORD_IDS_MAP` | PROV-N name | type QName | `provjson.py:219` |
| `PROV_BASE_CLS` | type `qn.uri` | base-type QName | `provxml.py:307`, `provrdf.py:546` |
| `PROV_ID_ATTRIBUTES_MAP` | attr `qn.uri` | `prov:`-prefixed display | `provrdf.py:115` |
| `PROV_ATTRIBUTES_ID_MAP` | `prov:`-prefixed display | attr QName | `provjson.py:235` |

### Recommended next item — `src/datetime.ts` then `src/literal.ts` (M2)

- **`src/datetime.ts` first** (a dependency of `literal.ts`): a luxon facade `ensureDateTime` /
  `parseXsdDateTime` / `toXsdDateTime` (`04 §8`, `model.py:65-74`). **Install luxon now** —
  `bun add luxon && bun add -d @types/luxon` — the first runtime dependency, pre-approved in
  `03-dependency-analysis.md`. Use `DateTime.fromISO(s, { setZone: true })` to preserve the source
  UTC offset; `parseXsdDateTime` returns `null` on failure.
- **`src/literal.ts`**: `Literal{value, datatype?, langtag?}` with `equals`/`key`/
  `provnRepresentation`; the langtag → `prov:InternationalizedString` forcing (`model.py:156-171`);
  and the XSD datatype parser table (`04 §3.2`). Carry the datatype on the value so int vs double
  survives the JS `number` collapse. Drive it from the 28-value `attribute_values` matrix in
  `tests/attributes.py` — the XSD constants (`XSD_INT`, `XSD_DOUBLE`, …) are now available.
- `src/error.ts` (the `ProvError`/`ProvException` hierarchy) can land alongside or just before the
  record layer (M3); it has no dependents yet.

### Verify before the next entry

```sh
bun test && bunx tsc --noEmit -p tsconfig.json && bun run build
```

---

## 2026-06-19 — Foundation: `identifier` + `intern` (first implementation PR)

**Agent:** automated migration loop. **Build:** `bun test` 21 pass / 0 fail · `tsc --noEmit` clean ·
`bun run build` (ESM + CJS + `.d.ts`) green.

### What shipped

- **`src/identifier.ts`** — `Identifier`, `QualifiedName`, `Namespace`, and the branded
  `QNameString` type. Faithful port of `reference/prov/src/prov/identifier.py`. Every value type
  exposes `equals(other)` + a canonical `key` getter encoding the exact Python `__hash__` inputs:
  - `QualifiedName.key === uri` — **prefix-independent** (`identifier.py:99-100`).
  - `Namespace.key === \`${prefix}\u0000${uri}\`` — **prefix participates** (`identifier.py:179-180`).
  - `Identifier.key === \`I\u0000${uri}\`` — **class folded in** (`identifier.py:38-39`), so an
    `Identifier` and a `QualifiedName` of the same URI are `equals()` yet occupy distinct keys
    (mirrors how they occupy distinct CPython dict slots).
  - `Namespace.qn(localpart)` memoizes per instance (replaces Python `__getitem__`,
    `identifier.py:185-191`).
- **`src/intern.ts`** — global intern tables: `internNamespace`/`ns` (singleton namespaces by
  `prefix\u0000uri`) and `internQName` (URI-keyed QName unification). `ns()` is what constants
  modules should use so `PROV_ENTITY === PROV.qn("Entity")` holds.
- **`src/identifier.test.ts`** — 21 tests pinning the equality/key/intern semantics, including the
  two-prefix-same-URI case (`EX` = `ex`, `EX_OTHER` = `other`, both `http://example.org/`) from
  `reference/.../tests/attributes.py:4-5`, and a Map-dedup test proving string keys work where
  reference keying fails.
- **`src/index.ts`** — now the real public barrel; exports the foundation types. Greeting scaffold
  (`src/greeting.ts`, `src/greeting.test.ts`) **removed** (M0 cleanup).
- **`CLAUDE.md`** — added `## TypeScript` + `## Conventions` sections (JSDoc-on-every-export,
  branded types, value-equality invariant, named-exports-only with the single `index.ts` barrel
  exception, extensionless imports, kebab-case filenames, `TODO(<tag>)`, deps policy). Distilled
  from `../inflexa/inflexa/CLAUDE.md`, keeping only library-applicable rules.

### Decisions & conventions established (follow these)

1. **Canonical key separator is `\u0000`** (the null char), written as the `\u0000` *escape* in
   source — never a literal NUL byte. (Authoring note: the editor tooling here has a habit of
   turning an intended separator space into a literal `U+0000`; if you see `grep -aP '\x00'` hits
   in a source file, run `perl -i -pe 's/\x00/\\u0000/g' <file>` to normalize. Verified clean in
   all committed files.)
2. **Extensionless relative imports** (`from "./identifier"`). `tsconfig.build.json` sets
   `allowImportingTsExtensions: false`; a `.ts` suffix breaks `bun run build:types`. (The base
   `tsconfig.json` allows them, so `.ts` imports typecheck in-editor but fail the build — don't be
   fooled.)
3. **`QualifiedName.toString()` returns the branded `QNameString`** (per `04 §3.1`). In tests,
   coerce with `String(qn)` before `expect(...).toBe("ex:foo")`, or `toBe` infers the brand and
   rejects the plain-string literal.
4. **`src/index.ts` is the one allowed barrel** — the package entry point. Internal modules import
   each other directly.

### Candidate deviation (not yet logged in DEVIATIONS.md — no semantic impact)

- `Namespace.qname(uri)` routes through the memoized `qn()`, returning the cached QName instance,
  whereas Python's `Namespace.qname` constructs a fresh `QualifiedName` each call
  (`identifier.py:160-161`). Value-equal; the TS version just shares instances. Create
  `DEVIATIONS.md` and record this if/when a second deviation arises.

### Recommended next item — `src/constants.ts` (M2)

Constants depend only on `intern` + `identifier` (both done), so this is the clean next step and
unblocks `literal` and the record layer.

- Source: `reference/prov/src/prov/constants.py` (216 lines).
- Mint **every** namespace (`PROV`, `XSD`, `XSI`), all type QNames (`PROV_ENTITY`, …, all 18
  record types), all `PROV_ATTR_*`, via `ns(...).qn(...)` so they're interned singletons.
- Build the wiring maps as **string-keyed** collections (keyed by `qn.uri`), never object-keyed:
  `PROV_N_MAP`, `ADDITIONAL_N_MAP`, `PROV_BASE_CLS`, `PROV_ATTRIBUTE_QNAMES`/`_LITERALS`/
  `PROV_ATTRIBUTES`, and the inverse maps (`04 §6`, `02` M2 row).
- **Open question to resolve** (`00-overview.md`): `PROV_RECORD_ATTRIBUTES` ordering derives from
  Python set-iteration; the TS port must define an **explicit** canonical order. Decide and note it.
- Then `src/literal.ts` + `src/datetime.ts` (M2). `datetime.ts` needs **luxon** — the first
  dependency to install (`bun add luxon` + `bun add -d @types/luxon`); it is pre-approved in
  `03-dependency-analysis.md`. `literal.ts` is XSD-datatype heavy; drive it from the 28-value
  `attribute_values` matrix in `tests/attributes.py`.

### How to verify before adding the next entry

```sh
bun test                        # all green
bunx tsc --noEmit -p tsconfig.json   # exit 0
bun run build                   # ESM + CJS + .d.ts, exit 0
```
