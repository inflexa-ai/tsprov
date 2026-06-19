# DEVIATIONS

Intentional, documented divergences from the reference Python `prov` (v2.1.1,
`reference/prov/`). Each is harmless to PROV-DM semantics or is forced by a
TypeScript/JS constraint. Anchors point into `reference/prov/src/prov`.

> Process: log every deliberate divergence here with its source anchor, the
> reason, and the blast radius. See `docs/migration/02-migration-roadmap.md` §4.

| # | Area | Python behavior (anchor) | tsprov behavior | Reason | Impact |
|---|------|--------------------------|-----------------|--------|--------|
| D1 | `Namespace.qname()` | Constructs a **fresh** `QualifiedName` each call (`identifier.py:160-161`). | Routes through the memoized `qn()`, returning the cached instance. | Interning is the whole point of `intern.ts`; value-equality is identical. | None — values are `equals()`-equal; the TS version just shares instances. |
| D2 | Datetime sub-second precision | `dateutil` + `datetime` keep **microseconds** (6 digits); `isoformat()` emits them. | luxon has **millisecond** resolution, so `…123456` round-trips as `…123000` (`datetime.ts`). | luxon is the chosen datetime lib (`03 §2`); no pure-JS lib preserves µs cleanly + offset. | Byte-parity breaks only for fixtures with sub-ms µs that aren't ms-multiples. **M5 must carry the raw lexical string for such literals.** |
| D3 | Naive (offset-less) datetimes | Kept naive; `isoformat()` emits no offset. | luxon assigns a zone (`fromISO`/`fromJSDate`), so an offset appears (`datetime.ts`). | luxon has no naive-datetime concept. | PROV data is normally tz-aware; revisit at M5 if the corpus has naive times. |
| D4 | Datetime parse leniency | `dateutil.parser.parse` accepts many non-ISO forms. | luxon `fromISO` is **ISO-8601 only** (`datetime.ts`). | Stricter is safer; xsd:dateTime is ISO. | Authoring with a non-ISO string throws where Python coerced. |
| D5 | `Literal` value stringification | `str(value)`: `str(2.0)=="2.0"`, `str(True)=="True"` (`model.py:155`). | `String(value)`: `String(2.0)==="2"`, `String(true)==="true"` (`literal.ts`). | JS `number` can't distinguish `2` from `2.0`; `String` is the idiom. | Harmless for the corpus **iff the JSON decoder passes lexical strings** (it must, M5). Only bare-number authoring is affected — the int/double collapse (risk register). |
| D6 | XSD numeric parsing | Bare `int()`/`float()` **raise** on malformed input (`model.py:98-114`). | `XSD_DATATYPE_PARSERS` numeric parsers return `null` (`literal.ts`). | Returning `null` is safer than throwing mid-parse. | Corpus values are always well-formed; only pathological input differs. |
| D7 | Warnings | `ProvWarning(Warning)` class + `logger.warning`/`debug` (`model.py:235`, `:158`, `:167`). | A settable `WarningHandler` callback (`setWarningHandler`, default `console.warn`) in `error.ts`. | No TS `Warning` analogue; an injectable callback is testable and library-friendly (`03 §3`). | Behaviorally equivalent (a diagnostic message); callers can silence or collect. |
| D8 | `ProvActivity.setTime` | Stores the time value **raw** (un-coerced) and replaces the set (`model.py:786,802`). | Same — `setTime` stores raw (a string stays verbatim; a JS `Date` → `DateTime` since `Date ∉ AttrValue`) and replaces via `AttributeStore.set` (`element.ts`). | Faithful to the Python quirk; raw strings also avoid the D3 naive-offset issue, *helping* byte-parity. | None / positive — a naive ISO string round-trips byte-identical. |
| D9 | `AttributeStore` ordering & read-mutation | `defaultdict(set)`: unordered values; reads insert empty keys (`model.py:293`). | Insertion-ordered, `valueKey`-deduped maps; reads never create entries (`record/attributes.ts`). | JS has no value-set; ordering is deterministic and read-mutation is a Python footgun. | TS output is deterministic where Python's set order was not (PROV equality is order-independent). |
| D10 | `unified()` | Shares the source's `NamespaceManager` by reference (`model.py:2603`). | Same — `ProvDocument.unified` assigns `doc._namespaces = this._namespaces` (shared). | Faithful to the Python quirk. | Mutating one document's namespaces would affect its unified copy. |
| D11 | `ProvDocument.flattened` | Returns `self` (identity) when there are no bundles (`model.py:2593`). | Same — returns `this` unchanged. | Faithful to the Python quirk. | A "flattened" document may be identity-equal to the original. |

## Planned (not yet implemented — will be logged when the code lands)

- **camelCase builder naming** (`model.py:2479-2497`): the camelCase PROV vocabulary becomes the
  **primary** API and the descriptive names become aliases — the inverse of Python (M4, `04 §4`).
- **Canonical attribute order**: already pinned in `constants.ts` as `PROV_ATTRIBUTES_ORDER`
  (replacing Python's nondeterministic `set` iteration) — see `05-progress-log.md` entry 2.
