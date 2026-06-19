# 04 — TypeScript Feasibility & Idiomatic Design Study

> **Thesis.** Do **not** transliterate `prov` (Python) line-by-line into TypeScript. The Python library leans on language features TS does not have — value-based `__eq__`/`__hash__`, operator overloading (`ns['Entity']`, `dict[QName]`), `collections.defaultdict`, multiple inheritance, runtime metaclass-free registries keyed by hashable objects, and `*args/**kwargs`. A faithful transliteration would either be broken (JS `Map`/`Set` key by reference, so `dict[QName]` silently fails) or un-idiomatic (no autocomplete, no type-safety on the authoring API, not tree-shakeable). Instead we **redesign each construct the TypeScript way while preserving PROV-DM semantics and the authoring ergonomics** (`doc.entity(...)`, `e.wasGeneratedBy(a)`, `doc.wasDerivedFrom(...)`).
>
> This document is the design study. It is opinionated and recommends. It is the companion to:
> - `01-codebase-analysis.md` — what the Python code does, module by module.
> - `02-migration-roadmap.md` — the phased execution plan and milestones.
> - `03-dependency-analysis.md` — third-party dependency replacements (luxon, N3, @xmldom/xmldom, ts-graphviz, graphology).
>
> All `file.py:NN` anchors point into `reference/prov/src/prov`.

---

## Table of contents

1. [Philosophy & DX goals](#1-philosophy--dx-goals)
2. [Target module layout](#2-target-module-layout)
3. [Type-system mapping (Python → TS)](#3-type-system-mapping-python--ts)
4. [The authoring API — the DX centerpiece](#4-the-authoring-api--the-dx-centerpiece)
5. [Porting hard Python idioms](#5-porting-hard-python-idioms)
6. [The equality/hashing deep-dive](#6-the-equalityhashing-deep-dive--the-single-biggest-semantic-risk)
7. [Serializers in TypeScript](#7-serializers-in-typescript)
8. [Datetime & XSD values](#8-datetime--xsd-values)
9. [Async, I/O, and dual targets](#9-async-io-and-dual-targets)
10. [Testing strategy & golden fixtures](#10-testing-strategy--golden-fixtures)
11. [Public API sketch](#11-public-api-sketch)
12. [Feasibility verdict & risks](#12-feasibility-verdict--risks)

---

## 1. Philosophy & DX goals

PROV-DM is a small, sharp data model: 3 element types (Entity, Activity, Agent), 15 relation classes, qualified-name identifiers, typed literals, and bundles. The Python library wraps it in a fluent factory API that is genuinely pleasant. Our job is to keep that ergonomics while making it feel native to a TypeScript developer. Concretely, **great DX for a PROV library** means:

| DX property | What it looks like | How we get it |
|---|---|---|
| **Autocomplete on relation builders** | typing `doc.` surfaces `entity`, `activity`, `agent`, `wasGeneratedBy`, `wasDerivedFrom`, … with correct parameter hints | concrete methods on `ProvBundle`/`ProvDocument` (not a stringly-typed `addRelation(type, …)`) |
| **Typed, ordered attributes** | formal attributes are named, ordered params; extra attributes are a typed map | per-relation method signatures + a `ProvAttributeBag` input type |
| **Branded QNames** | a `QualifiedName` cannot be confused with a `string`, and `'prov:Entity'` is a distinct *type* | branded string template types + a value-class with `.uri`/`.toString()` |
| **Value-equality that actually works** | `doc1.equals(doc2)` returns `true` for structurally-equal docs; records dedupe in sets | canonical string keys + explicit `equals()` (see §6) |
| **Tree-shakeable** | importing the JSON serializer does not pull in RDF/XML/graphviz | `sideEffects: false` (already set in `package.json`), subpath exports, no top-level registry side effects |
| **Works in Node, Bun, and the browser** | the core has zero native deps; serializers are pure string/bytes | no `node:fs` in core (use `Bun.file`/`fetch` at the edges), luxon not native bindings, optional heavy deps gated |
| **ESM-first, dual-published** | `import { ProvDocument } from "tsprov"` works; CJS still resolves | already wired: `exports` map, `bun build` ESM+CJS, `tsc` for `.d.ts` |
| **Strict-mode clean** | compiles under `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` | design types up front; never `any` at the boundary |

Three non-negotiable design rules fall out of this:

1. **No object-keyed `Map`/`Set` for value semantics.** Python keys dicts/sets by `QualifiedName.__hash__`/`Literal.__hash__`/`ProvRecord.__hash__`. JS keys by reference. Every such structure becomes a `Map<string, …>` keyed by a *canonical string* (`§6`). This is the load-bearing decision; get it wrong and round-trip equality silently diverges.
2. **No operator overloading.** `ns['Entity']` (`identifier.py:185`), `dict[QName]`, `doc1 != doc2` become methods: `ns.qn('Entity')`, `map.get(qn.uri)`, `doc1.equals(doc2)`.
3. **Class hierarchy stays; behavior is method-based, not reflection-based.** The Python class hierarchy (ProvRecord → ProvElement/ProvRelation → concrete) maps cleanly onto TS classes (`§3`). We keep classes; we replace duck-typing (`try: x.provn_representation()`) with `instanceof`/interface checks.

---

## 2. Target module layout

The canonical target layout from the migration brief stands almost verbatim. I propose **four refinements**, each marked **[CHANGED]** with a justification. Everything else is **[KEEP]**.

```
src/
  index.ts                  [KEEP]    public barrel
  error.ts                  [KEEP]    ProvError base (was prov.Error)
  identifier.ts             [KEEP]    Identifier, QualifiedName, Namespace
  constants.ts              [KEEP]    PROV/XSD namespaces, type QNames, maps
  literal.ts                [KEEP]    Literal + XSD datatype handling
  datetime.ts               [KEEP]    xsd:dateTime/date/time parse+format (luxon)
  intern.ts                 [CHANGED, NEW] global QName/Namespace intern table (§6)
  record/
    record.ts               [KEEP]    ProvRecord base (abstract)
    element.ts              [KEEP]    ProvElement + Entity/Activity/Agent
    relation.ts             [KEEP]    ProvRelation + all 15 relation classes
    registry.ts             [KEEP]    type-QName → record class registry (PROV_REC_CLS)
    attributes.ts           [CHANGED, NEW] AttributeStore (ordered, deduped, keyed) (§5,§6)
  namespace-manager.ts      [KEEP]    NamespaceManager
  bundle.ts                 [KEEP]    ProvBundle + factory/authoring API
  document.ts               [KEEP]    ProvDocument
  serializers/
    serializer.ts           [KEEP]    Serializer interface + Registry
    json.ts                 [KEEP]    PROV-JSON
    provn.ts                [KEEP]    PROV-N (serialize only)
    xml.ts                  [KEEP]    PROV-XML (optional, separate entry)
    rdf.ts                  [KEEP]    PROV-RDF (optional, separate entry)
  graph.ts                  [KEEP]    prov ↔ graph (optional)
  dot.ts                    [KEEP]    prov → DOT (optional)
  cli/
    convert.ts , compare.ts [KEEP]    bin entry points
```

### Refinements

- **[CHANGED, NEW] `src/intern.ts`** — a tiny global intern table for `Namespace` and `QualifiedName`. The Python code relies on per-`Namespace` memoization (`identifier.py:185`) so that `PROV['Entity'] is PROV['Entity']`. We go one better: a process-global intern keyed by canonical string makes equal QNames the *same object*, which lets hot paths use `===` *and* gives us free value-equality. This is the single best leverage point for the equality problem (§6). It is `sideEffects: false`-safe because interning is lazy and pure.

- **[CHANGED, NEW] `src/record/attributes.ts`** — extract the `defaultdict(set)` attribute store (`model.py:293`) into its own `AttributeStore` class rather than burying it in `record.ts`. It is the locus of the trickiest semantics (set-dedup-by-value, ordered list view, single-valued formal enforcement, `add_attributes` at `model.py:443-526`). Isolating it makes it unit-testable against the golden corpus and keeps `ProvRecord` readable.

- **[CHANGED] Serializers split into core vs optional entry points.** `serializers/json.ts` and `serializers/provn.ts` ship in the core barrel. `serializers/xml.ts` (needs `@xmldom/xmldom`) and `serializers/rdf.ts` (needs `n3`) are exposed under **subpath exports** so they are opt-in and tree-shaken out by default:

  ```jsonc
  // package.json (extends the existing exports map)
  "exports": {
    ".":            { "import": "./dist/index.js",            "require": "./dist/index.cjs", "types": "./dist/index.d.ts" },
    "./xml":        { "import": "./dist/serializers/xml.js",  "require": "./dist/serializers/xml.cjs", "types": "./dist/serializers/xml.d.ts" },
    "./rdf":        { "import": "./dist/serializers/rdf.js",  "require": "./dist/serializers/rdf.cjs", "types": "./dist/serializers/rdf.d.ts" },
    "./graph":      { "import": "./dist/graph.js",            "require": "./dist/graph.cjs",            "types": "./dist/graph.d.ts" },
    "./dot":        { "import": "./dist/dot.js",              "require": "./dist/dot.cjs",              "types": "./dist/dot.d.ts" }
  }
  ```
  `n3`, `@xmldom/xmldom`, `ts-graphviz`, `graphology` become **`peerDependencies` + `peerDependenciesMeta.optional`** (see `03-dependency-analysis.md` §4). The core has only `luxon`.

- **[CHANGED] `record/registry.ts` exposes a `registerRecordClass(qn, ctor)` function**, not a bare module-level mutable dict. Python populates `PROV_REC_CLS` after all class defs (`model.py:1101`). In TS we register each class next to its definition; the registry stays a `Map<string, RecordCtor>` keyed by `qn.uri`. This avoids a circular-import dance and keeps the module pure-ish.

---

## 3. Type-system mapping (Python → TS)

### 3.1 `Identifier` / `QualifiedName` / `Namespace`

Ground truth (`identifier.py`):
- `Identifier.__eq__` compares `.uri` only, returns `False` (not `NotImplemented`) for non-Identifiers (`identifier.py:35-36`).
- `Identifier.__hash__ = hash((uri, class))` — **includes the class** (`identifier.py:38-39`).
- `QualifiedName.__hash__ = hash(uri)` — **drops the class** (`identifier.py:99-100`), so two QNames are equal ⇔ hash-equal ⇔ URIs match. **Prefix is irrelevant to QName identity.**
- `Namespace.__hash__ = hash((uri, prefix))` and `__eq__` compares `(uri, prefix)` (`identifier.py:165-180`) — **prefix participates in Namespace identity** (the deliberate asymmetry).
- `Namespace.__getitem__` memoizes per-instance (`identifier.py:185-191`).

The branded-type angle: PROV qualified names display as `prefix:localpart` (or bare `localpart` when prefix is empty, `identifier.py:79-81`). We capture that shape at the type level with a template-literal type so `'prov:Entity'` is distinguishable from an arbitrary string, while the runtime value is a small immutable class carrying `uri`, `namespace`, `localpart`, and a precomputed display string.

```ts
// identifier.ts — branded display type + value classes

/** A `prefix:local` (or bare `local`) display form, branded so it can't be mistaken for a free string. */
export type QNameString = string & { readonly __qname: unique symbol };

export class Identifier {
  /** xsd:anyURI value AND base id. Equality is by uri only (identifier.py:35). */
  readonly uri: string;
  constructor(uri: string) { this.uri = String(uri); }

  toString(): string { return this.uri; }
  /** mirrors __eq__: same class-family, uri-equal. */
  equals(other: unknown): boolean { return other instanceof Identifier && other.uri === this.uri; }
  /** mirrors Identifier.__hash__ = hash((uri, class)): class IS part of the key. */
  get key(): string { return `I\u0000${this.uri}`; }     // 'I\0<uri>'
  provnRepresentation(): string { return `"${this.uri}" %% xsd:anyURI`; } // literal %% (identifier.py:51)
}

export class QualifiedName extends Identifier {
  readonly namespace: Namespace;
  readonly localpart: string;
  private readonly _display: QNameString;

  constructor(namespace: Namespace, localpart: string) {
    super(namespace.uri + localpart);                    // identifier.py:76
    this.namespace = namespace;
    this.localpart = localpart;
    this._display = (namespace.prefix
      ? `${namespace.prefix}:${localpart}`
      : localpart) as QNameString;                       // identifier.py:79-81
  }

  override toString(): QNameString { return this._display; }
  /** mirrors QualifiedName.__hash__ = hash(uri): class dropped, so QName key == uri. */
  override get key(): string { return this.uri; }        // <-- the crux (identifier.py:100)
  override provnRepresentation(): string { return `'${this._display}'`; } // identifier.py:104
}

export class Namespace {
  readonly prefix: string;
  readonly uri: string;
  private readonly _cache = new Map<string, QualifiedName>(); // identifier.py:121

  constructor(prefix: string, uri: string) {
    if (!uri || /^\s*$/.test(uri)) throw new Error("Not a valid URI to create a namespace."); // identifier.py:117
    this.prefix = prefix;
    this.uri = uri;
  }

  /** Replaces __getitem__: ns.qn('Entity') memoizes like ns['Entity'] (identifier.py:185-191). */
  qn(localpart: string): QualifiedName {
    let q = this._cache.get(localpart);
    if (!q) { q = new QualifiedName(this, localpart); this._cache.set(localpart, q); }
    return q;
  }

  /** True iff the identifier's URI starts with this namespace's URI (identifier.py:133). */
  contains(identifier: string | Identifier): boolean {
    const uri = identifier instanceof Identifier ? identifier.uri : identifier;
    return uri != null && uri.startsWith(this.uri);
  }

  /** Reverse lookup: full URI → QualifiedName in this namespace, else null (identifier.py:147).
   *  Used by NamespaceManager to resolve a bare URI back to a prefixed QName. */
  qname(identifier: string | Identifier): QualifiedName | null {
    const uri = identifier instanceof Identifier ? identifier.uri : identifier;
    return uri != null && uri.startsWith(this.uri)
      ? this.qn(uri.slice(this.uri.length))
      : null;
  }

  /** Namespace identity INCLUDES prefix (identifier.py:165-180) — deliberately unlike QName. */
  equals(other: unknown): boolean {
    return other instanceof Namespace && other.uri === this.uri && other.prefix === this.prefix;
  }
  get key(): string { return `${this.prefix}\u0000${this.uri}`; }
}
```

Two deliberate fidelity calls, both documented in code:

- **The `key` getters encode the exact hashing rules.** `Identifier.key = 'I\0<uri>'` (class in the key), `QualifiedName.key = <uri>` (class dropped). That reproduces the subtle Python invariant that `Identifier(uri)` and `QualifiedName(uri)` are `==` but generally do **not** collide in a dict (different hashes) — see `§6` and the tricky note at `identifier.py:35-36/99-100`.
- **`Namespace.equals` includes prefix; `QualifiedName.equals` does not.** We preserve the asymmetry on purpose. The two example namespaces in the test corpus (`ex` and `other`, both `http://example.org/`, `tests/attributes.py:4-5`) exist precisely to pin this down: QNames from different-prefix-same-URI namespaces must compare equal.

> **Why not `===` operator overloading or `Symbol.toPrimitive`?** TS has neither operator overloading nor value-equality hooks for `Map`/`Set`. `Symbol.toPrimitive` only helps string coercion, not `Map` keying. The honest, discoverable answer is `.equals()` + `.key`. Interning (`§6`, `src/intern.ts`) then lets us *also* use `===` in hot paths.

### 3.2 `Literal` & XSD datatypes

Python's `Literal` stores `value` always as a string, an optional `datatype` QName, and an optional `langtag`; a langtag forces `prov:InternationalizedString` (`model.py:155-174`). Equality/hash are structural over `(value, datatype, langtag)` (`model.py:182-197`).

The big TS hazard is the **`int`/`float`/`long` collapse**: Python distinguishes `int` vs `float` and the JSON/RDF encoders key on the Python *type* to emit `xsd:int` vs `xsd:double` (`provjson.py:52`, `provrdf.py:75`). JS has one `number`. **The fix: carry the datatype on the value.** Internally, typed scalars are represented as `Literal{value, datatype}` so the encoder never has to *infer* xsd:int-vs-double from a bare number.

```ts
// literal.ts

export class Literal {
  readonly value: string;                 // always a string (model.py:155)
  readonly datatype?: QualifiedName;
  readonly langtag?: string;

  constructor(value: unknown, datatype?: QualifiedName, langtag?: string) {
    this.value = String(value);
    if (langtag != null) {
      // langtag forces prov:InternationalizedString (model.py:156-171); warn on disagreement
      if (datatype && !datatype.equals(PROV_INTERNATIONALIZEDSTRING)) {
        warn(`Invalid data type (${datatype}) for "${value}"@${langtag}, overridden.`);
      }
      this.datatype = PROV_INTERNATIONALIZEDSTRING;
      this.langtag = String(langtag);
    } else {
      this.datatype = datatype;
    }
  }

  hasNoLangtag(): boolean { return this.langtag == null; }

  equals(other: unknown): boolean {
    return other instanceof Literal
      && other.value === this.value
      && qnEq(other.datatype, this.datatype)   // §6 helper: undefined-safe QName eq
      && other.langtag === this.langtag;
  }
  /** structural key for Set/Map dedup — replaces hash((value, datatype, langtag)). */
  get key(): string {
    return `L\u0000${this.value}\u0000${this.datatype?.uri ?? ""}\u0000${this.langtag ?? ""}`;
  }

  provnRepresentation(): string {
    const q = quoteMaybeMultiline(this.value);              // model.py:121
    return this.langtag
      ? `${q}@${this.langtag}`                              // model.py:217
      : `${q} %% ${this.datatype?.toString() ?? ""}`;      // model.py:222
  }
}
```

**XSD datatype handling** is a small discriminated module. The parser table (`model.py:98 XSD_DATATYPE_PARSERS`) and its reverse (`LITERAL_XSDTYPE_MAP`) become explicit, with the int/double distinction preserved by *datatype tag*, never by `typeof value`:

```ts
// constants.ts (excerpt) — XSD type QNames as interned singletons
export const XSD = ns("xsd", "http://www.w3.org/2001/XMLSchema#");
export const XSD_STRING   = XSD.qn("string");
export const XSD_INT      = XSD.qn("int");
export const XSD_LONG     = XSD.qn("long");
export const XSD_DOUBLE   = XSD.qn("double");
export const XSD_FLOAT    = XSD.qn("float");
export const XSD_BOOLEAN  = XSD.qn("boolean");
export const XSD_DATETIME = XSD.qn("dateTime");
export const XSD_ANYURI   = XSD.qn("anyURI");

// the "native value" a literal of a given datatype decodes to
export type XsdParser = (lex: string) => unknown | null;
export const XSD_DATATYPE_PARSERS = new Map<string, XsdParser>([   // keyed by datatype.uri (§6)
  [XSD_STRING.uri,   (s) => s],
  [XSD_DOUBLE.uri,   (s) => { const n = Number(s); return Number.isNaN(n) ? null : n; }],
  [XSD_FLOAT.uri,    (s) => { const n = Number(s); return Number.isNaN(n) ? null : n; }],
  [XSD_LONG.uri,     (s) => parseIntOrNull(s)],
  [XSD_INT.uri,      (s) => parseIntOrNull(s)],
  [XSD_BOOLEAN.uri,  (s) => parseXsdBoolean(s)],            // tri-state true/false/null (model.py:80)
  [XSD_DATETIME.uri, (s) => parseXsdDateTime(s)],           // luxon, null on fail (model.py:72)
  [XSD_ANYURI.uri,   (s) => new Identifier(s)],
]);
```

> **Recommendation: model authored numbers as `Literal` when fidelity matters.** Bare `number` attributes default to `xsd:double` on encode (matching `provjson.py:52` for `float`). Callers who need `xsd:int` pass `new Literal(5, XSD_INT)`. This is the only honest way to survive the int/double collapse on round-trips, and the test corpus (`tests/attributes.py` 28-value matrix) exercises every XSD numeric type, so the distinction is checked.

### 3.3 The record class hierarchy — keep classes, not discriminated unions

This is a real fork. Two viable shapes:

| Option | Shape | Pros | Cons |
|---|---|---|---|
| **A. Class hierarchy (recommended)** | `ProvRecord` (abstract) → `ProvElement`/`ProvRelation` → 15 relation + 3 element concrete classes (14 direct `ProvRelation` subclasses + `ProvMention ⊂ ProvSpecialization`), each with `static FORMAL_ATTRIBUTES` and `static prov_type` | 1:1 with Python (`model.py:269-1099`); polymorphic `getProvN`, `copy`, fluent `this`-returning methods live where they belong; `instanceof` checks for `isElement`/`isRelation`; matches `ProvMention extends ProvSpecialization` (`model.py:1079`) naturally | classes carry runtime weight; static-member polymorphism needs a small pattern in TS |
| **B. Discriminated union** | `type ProvRecord = { kind: 'entity', … } \| { kind: 'wasGeneratedBy', … } \| …` + free functions | exhaustive `switch` with `never` checks; data is plain/serializable; arguably more "FP" | loses the fluent `record.wasGeneratedBy(...)` API (no methods on data); `copy()`/`getProvN()` become giant switches; two-level `Mention`/`Specialization` relationship is awkward; the registry (`PROV_REC_CLS`) and `sorted_attributes` want a *class* with `FORMAL_ATTRIBUTES` |

**Recommendation: Option A, classes.** The authoring DX (§4) hinges on methods (`e.wasGeneratedBy(a).wasAttributedTo(ag)`), `copy()` dispatches through a class registry (`model.py:304`), and `sorted_attributes` reads `cls.FORMAL_ATTRIBUTES` (`model.py:2810`). Discriminated unions would force all of that into switch statements and throw away the fluent chain. We keep the hierarchy and add discriminants *as accessors* (`isElement()`, `isRelation()`, `provType`) so callers can still narrow.

```ts
// record/record.ts
export abstract class ProvRecord {
  /** class-variable polymorphism → static members. Subclasses override. */
  static readonly FORMAL_ATTRIBUTES: readonly QualifiedName[] = [];
  static readonly prov_type: QualifiedName | null = null;

  protected readonly attrs = new AttributeStore();      // §5 — replaces defaultdict(set)
  constructor(protected bundle: ProvBundle, readonly identifier: QualifiedName | null) {}

  /** read the subclass's static prov_type (model.py:get_type). */
  getType(): QualifiedName {
    const t = (this.constructor as typeof ProvRecord).prov_type;
    if (!t) throw new Error("prov_type not set");
    return t;
  }
  get formalAttributesOrder(): readonly QualifiedName[] {
    return (this.constructor as typeof ProvRecord).FORMAL_ATTRIBUTES;
  }

  isElement(): this is ProvElement { return false; }    // overridden true in ProvElement
  isRelation(): this is ProvRelation { return false; }

  abstract /* concrete via shared impl */ getProvN(): string;
  equals(other: unknown): boolean { /* §6 */ }
  get key(): string { /* §6 — replaces __hash__ */ }
}

// record/element.ts
export abstract class ProvElement extends ProvRecord {
  constructor(bundle: ProvBundle, id: QualifiedName | null) {
    if (id == null) throw new ProvElementIdentifierRequired();  // raised at model.py:624 (class def model.py:259)
    super(bundle, id);
  }
  override isElement(): this is ProvElement { return true; }
}

export class ProvEntity extends ProvElement {
  static override readonly prov_type = PROV_ENTITY;
  // fluent helpers delegate to the bundle and return this (model.py:663+)
  wasGeneratedBy(activity?: EntityRef, time?: DateLike, opts?: RelOpts): this {
    this.bundle.generation(this, activity, time, opts); return this;
  }
  wasDerivedFrom(used: EntityRef, opts?: DerivationOpts): this {
    this.bundle.derivation(this, used, opts); return this;
  }
  // … wasInvalidatedBy, wasAttributedTo, alternateOf, specializationOf, hadMember
}

export class ProvActivity extends ProvElement {
  static override readonly FORMAL_ATTRIBUTES = [PROV_ATTR_STARTTIME, PROV_ATTR_ENDTIME] as const;
  static override readonly prov_type = PROV_ACTIVITY;
  // …
}

// record/relation.ts
export abstract class ProvRelation extends ProvRecord {
  override isRelation(): this is ProvRelation { return true; }
}
export class ProvSpecialization extends ProvRelation {
  static override readonly FORMAL_ATTRIBUTES = [PROV_ATTR_SPECIFIC_ENTITY, PROV_ATTR_GENERAL_ENTITY] as const;
  static override readonly prov_type = PROV_SPECIALIZATION;
}
/** two-level hierarchy, exactly like model.py:1079 — Mention IS-A Specialization. */
export class ProvMention extends ProvSpecialization {
  static override readonly FORMAL_ATTRIBUTES =
    [PROV_ATTR_SPECIFIC_ENTITY, PROV_ATTR_GENERAL_ENTITY, PROV_ATTR_BUNDLE] as const;
  static override readonly prov_type = PROV_MENTION;
}
```

> **Note on `static` polymorphism.** Reading `(this.constructor as typeof ProvRecord).FORMAL_ATTRIBUTES` is the idiomatic TS way to get "the subclass's class variable." It is type-safe and matches Python's `self.FORMAL_ATTRIBUTES` resolution. We expose it via the `formalAttributesOrder` accessor so serializers don't reach into `.constructor`.

---

## 4. The authoring API — the DX centerpiece

This is what users touch. We must preserve the Python fluent factory (`doc.entity`, `doc.wasDerivedFrom`, `e.wasGeneratedBy`) and the **camelCase PROV vocabulary aliases** (`model.py:2479-2497`), while adding type-safety Python never had.

### 4.1 Relation naming — keep PROV camelCase as primary

Python exposes *both* `generation` and `wasGeneratedBy` as the **same function object** (`model.py:2480`). In TS:

- **Primary names = PROV camelCase** (`wasGeneratedBy`, `wasDerivedFrom`, `wasAttributedTo`, `actedOnBehalfOf`, `specializationOf`, `hadMember`, …). They match the serialization vocabulary, are what PROV practitioners type, and read well in a fluent chain.
- **Aliases = the descriptive snake-ish names** (`generation`, `usage`, `derivation`, …) kept for parity and for users porting Python code. Both reference the *same implementation* (an assignment, not a copy):

```ts
// bundle.ts (excerpt)
class ProvBundle {
  wasGeneratedBy(entity: EntityRef, activity?: ActivityRef, time?: DateLike, opts?: RelOpts): ProvGeneration { /* … */ }
  // alias — identical method, like Python's `wasGeneratedBy = generation`
  generation = this.wasGeneratedBy;
  // …repeat for all 18
}
```

> Using `generation = this.wasGeneratedBy` as an instance arrow-bound alias keeps a single implementation and keeps `this` correct when destructured. (Class-field aliasing also means autocomplete shows both names.)

### 4.2 Attributes — formal as params, extra as a typed bag

Formal attributes are the relation's positional slots; extra attributes are free-form. We give formal attributes **named parameters** and extra attributes a single typed input. `**kwargs`/dict-or-tuples (`model.py:1740`) becomes a discriminated input type with order-preserving normalization:

```ts
// attribute input: object form OR ordered pair-array form (both preserve insertion order)
export type AttrKey = QualifiedName | QNameString | string;     // resolved via valid_qualified_name
export type AttrValue = string | number | boolean | Date | DateTime | QualifiedName | Identifier | Literal;
export type ProvAttributes =
  | Record<string, AttrValue | AttrValue[]>                     // {'ex:role': 'author'}
  | ReadonlyArray<readonly [AttrKey, AttrValue]>;               // [['ex:role','author'], ['ex:role','editor']] (dup keys!)

// common relation options
export interface RelOpts { id?: AttrKey | null; attributes?: ProvAttributes; }
export interface DerivationOpts extends RelOpts {
  activity?: ActivityRef; generation?: GenerationRef; usage?: UsageRef;
}
```

The pair-array form is essential: PROV allows **duplicate attribute names** (e.g. seven `prov:type` values in `add_types`, `tests/statements.py`), which an object cannot express. The object form is the ergonomic 90% case; the array form is the escape hatch. Both normalize to an ordered `Array<[QualifiedName, value]>` internally (insertion order preserved, matching Python dict order at `model.py:1740-1752`).

### 4.3 End-to-end authoring example

```ts
import { ProvDocument, Literal, XSD_INT } from "tsprov";

const doc = new ProvDocument();
doc.addNamespace("ex", "http://example.org/");
doc.setDefaultNamespace("http://example.org/");

// elements — autocomplete on doc.entity / doc.activity / doc.agent
const article  = doc.entity("ex:article", { "prov:type": "ex:Article", "ex:words": new Literal(5000, XSD_INT) });
const blog     = doc.entity("ex:blog");
const compile  = doc.activity("ex:compile", "2024-01-01T09:00:00Z", "2024-01-01T09:05:00Z");
const author   = doc.agent("ex:alice", { "prov:type": "prov:Person", "foaf:name": "Alice" });

// relations — PROV camelCase primary, fully typed params
doc.wasGeneratedBy(article, compile, "2024-01-01T09:05:00Z");
doc.used(compile, blog);
doc.wasAttributedTo(article, author);
doc.wasAssociatedWith(compile, author, /* plan */ undefined, { attributes: { "prov:role": "editor" } });

// fluent record-style — equivalent to the above, returns `this` for chaining
article
  .wasDerivedFrom(blog)
  .wasAttributedTo(author);

// duplicate attribute keys via the pair-array escape hatch
doc.entity("ex:multi", [
  ["prov:type", "ex:A"],
  ["prov:type", "ex:B"],   // legal — duplicate names allowed
]);

// bundles
const bundle = doc.bundle("ex:bundle1");
bundle.entity("ex:nested");

// serialize (string, sync — see §7)
const json  = doc.serialize("json");
const provn = doc.serialize("provn");
```

Type-safety wins over Python here:

- `doc.wasGeneratedBy(article, compile)` — `article` is `EntityRef = ProvEntity | QualifiedName | QNameString`, `compile` is `ActivityRef`. Passing an agent where an activity is expected is a **compile error**. Python accepts anything and fails (or doesn't) at runtime.
- `doc.entity("ex:article")` returns `ProvEntity`, so `.wasGeneratedBy` is available on the result; `doc.wasGeneratedBy(...)` returns `ProvGeneration`. The result types are precise, not `ProvRecord`.
- Attribute values are constrained to `AttrValue`; a stray object literal is rejected at compile time.

> **One DX deviation from Python, flagged:** the subtype relations (`wasRevisionOf`, `wasQuotedFrom`, `hadPrimarySource`, `collection`) are still derivation/entity with an asserted `prov:type` (`model.py:2191-2400`). We keep them as distinct *methods* (great autocomplete) but they build the base class + `addAssertedType(PROV.qn('Revision'))`, exactly like Python. No new classes.

---

## 5. Porting hard Python idioms

| Python idiom | Where | TS replacement |
|---|---|---|
| `__eq__`/`__hash__` value semantics → `dict[QName]`, `set(records)` | everywhere | `.equals()` + `.key` getter; `Map<string,…>`/keyed dedup (§6) |
| Operator `ns['Entity']` (`__getitem__`) | `identifier.py:185` | `ns.qn('Entity')` method, memoized |
| Operator `doc1 != doc2` (`__eq__`/`__ne__`) | `model.py:1619` | `doc1.equals(doc2)` |
| `collections.defaultdict(set)` for attributes | `model.py:293` | `AttributeStore` w/ `getOrInit` helper; **no auto-insert on read** |
| `defaultdict(list)` for `_id_map` | `model.py:1396` | `MultiMap` / `getOrInit(map,k,()=>[])`; `getRecord` returns `[]` on miss without polluting |
| `*args`/`**kwargs`, dict-or-iterable attrs | `model.py:1740` | method overloads + `ProvAttributes` union + option objects |
| Multiple inheritance `ProvMention(ProvSpecialization)` | `model.py:1079` | single-chain `class ProvMention extends ProvSpecialization` (it's IS-A, not a mixin) |
| `NamespaceManager(dict)` (subclasses dict) | `model.py:1127` | composition: class wrapping `Map<string,Namespace>` + side-maps; **no dict subclassing** |
| Dynamic dispatch `getattr(bundle, name)(...)` (RDF decode) | `provrdf.py:610` | explicit `Record<string,(b,…)=>void>` dispatch table |
| Metaclass-free registry `PROV_REC_CLS[type](...)` | `model.py:1101` | typed `Map<string, RecordCtor>` keyed by `qn.uri`; `new ctor(...)` |
| Duck typing `try: x.provn_representation()` | `model.py:578-582` | `instanceof Literal`/`QualifiedName` or a `HasProvN` interface check |
| `set` iteration "first()" of a value | `model.py:117` | `Set` preserves insertion order → **more** deterministic (flag in tests) |
| C-style `%g`/`%i`, `%%`/`%%%%` escaping | `model.py:132` | manual formatters (`formatG`, `String(n|0)`); literal `'%%'` strings |
| `for/else`, bare `except: pass` (format probing) | `__init__.py:47-53` | `for` loop + `try/catch {}`; throw `TypeError`-equiv if none succeed |

A few deserve prose.

**`defaultdict` — and the "read mutates" trap.** Python's `defaultdict(set)` *inserts an empty set on read* (`model.py:293`), so `label`/`get_asserted_types`/`get_provn` accidentally create empty keys. A TS `Map.get` returns `undefined` and does *not* mutate. **Recommendation: do not reproduce the empty-key artifact.** Audit the readers (`label`, `getAssertedTypes`, `value`, `getProvN`) and ensure they tolerate a missing key. This is a *cleaner* behavior; flag it as an intentional, harmless deviation (no serializer output depends on phantom empty keys).

```ts
// helpers.ts
export function getOrInit<K, V>(m: Map<K, V>, k: K, make: () => V): V {
  let v = m.get(k);
  if (v === undefined) { v = make(); m.set(k, v); }
  return v;
}
// reads use plain get (no mutation):
const labels = this.attrs.get(PROV_LABEL.uri) ?? [];
```

**The single-valued formal-attribute rule** (`model.py:505-524`) is the trickiest single behavior. A second value for a formal attr **raises if different, is silently ignored if equal**, with a `try/except TypeError` that treats non-comparable values as different (so they raise). `is_collection` (presence of `PROV_ATTR_COLLECTION` among incoming attrs, `model.py:460`) disables the check. Faithful port:

```ts
// record/attributes.ts (inside add())
if (!isCollection && PROV_ATTRIBUTES.has(attr.uri) && store.has(attr.uri)) {
  const existing = first(store.get(attr.uri)!);          // Set preserves insertion order
  let notSame = true;
  try { notSame = !valueEquals(value, existing); }       // value-equality, never ===
  catch { /* non-comparable → treat as different (model.py:514-516) */ }
  if (notSame) throw new ProvException(`Cannot have more than one value for attribute ${attr}`);
  else return;                                            // same value → ignore (model.py:522-524)
}
```

**`NamespaceManager` does NOT subclass a dict in TS.** Python's `NamespaceManager(dict)` is the prefix→Namespace map *and* carries side registries (`model.py:1127`). We compose: an internal `Map<string,Namespace>` for prefixes plus `_uriMap`, `_renameMap` (keyed by `Namespace.key`, since JS Maps key by reference), `_prefixRenamedMap`. Crucially, `add_namespace` may **return a different Namespace** than passed (URI dedup / prefix rename, `model.py:1203-1243`) — the TS signature must return the effective namespace and callers must use it.

---

## 6. The equality/hashing deep-dive — the single biggest semantic risk

Everything else is mechanical. **This is the part that silently breaks if done naively.** Python's entire correctness model — and the test oracle (`tests/utility.py` `RoundTripTestCase`, `01-codebase-analysis.md` §tests) — bottoms out in value-based `__eq__`/`__hash__` used as `dict`/`set` keys:

- `QualifiedName` keys `PROV_N_MAP`, `PROV_BASE_CLS`, `PROV_REC_CLS`, `INFERRED_ELEMENT_CLASS`, `DOT_PROV_STYLE`, and the attribute store (`constants.py`, `model.py:1101`, `graph.py:36`, `dot.py:93`).
- `Literal` dedupes inside the attribute `set` (`model.py:196`).
- `ProvRecord` goes into `set()` for bundle equality and unification (`model.py:1619`, `model.py:1649`).

**JS `Map`/`Set` key by reference identity.** A literal `new QualifiedName(PROV, 'Entity')` used as a `Map` key will *never* match a different-but-equal instance. So a 1:1 port using objects as keys is not "slightly off" — it's *wrong*: lookups miss, dedup fails, `doc1.equals(doc2)` returns false for equal docs.

### Strategy: canonical string keys + interning + explicit `equals()`

Three coordinated mechanisms:

1. **Canonical `key` getter on every value type** (already shown): `QualifiedName.key = uri`, `Literal.key = 'L\0value\0datatype\0langtag'`, `Identifier.key = 'I\0uri'`, `ProvRecord.key = type|id|sortedAttrKeys`. These reproduce the exact Python hash inputs.
2. **A global intern table** (`src/intern.ts`) so equal QNames/Namespaces are the *same object*. This recreates Python's per-namespace memoization *and* lets hot paths use `===`. Constants become interned singletons (`PROV_ENTITY === PROV.qn('Entity')`).
3. **Explicit `equals()`** for the cases where we can't intern (records are mutable; bundles are deliberately non-hashable, `model.py:1646`).

```ts
// intern.ts
const namespaces = new Map<string, Namespace>();    // key: prefix\0uri
const qnames     = new Map<string, QualifiedName>(); // key: uri  (prefix-independent, identifier.py:100)

export function internNamespace(prefix: string, uri: string): Namespace {
  const key = `${prefix}\u0000${uri}`;
  let n = namespaces.get(key);
  if (!n) { n = new Namespace(prefix, uri); namespaces.set(key, n); }
  return n;
}
export function ns(prefix: string, uri: string): Namespace { return internNamespace(prefix, uri); }

/** Intern a QName by URI so equal QNames are ===. Mirrors the value-equality invariant. */
export function internQName(qn: QualifiedName): QualifiedName {
  const existing = qnames.get(qn.uri);
  if (existing) return existing;
  qnames.set(qn.uri, qn);
  return qn;
}
```

Constant maps become **string-keyed**, never object-keyed:

```ts
// constants.ts — Python: PROV_N_MAP = { PROV_ENTITY: 'entity', ... } keyed by QName
export const PROV_N_MAP = new Map<string, string>([          // keyed by qn.uri
  [PROV_ENTITY.uri,     "entity"],
  [PROV_GENERATION.uri, "wasGeneratedBy"],
  // …
]);
// lookup: PROV_N_MAP.get(record.getType().uri)

export const PROV_ATTRIBUTE_QNAMES  = new Set<string>([PROV_ATTR_ENTITY.uri, /* … */]); // membership by uri
export const PROV_ATTRIBUTE_LITERALS = new Set<string>([PROV_ATTR_TIME.uri, PROV_ATTR_STARTTIME.uri, PROV_ATTR_ENDTIME.uri]);
export const PROV_ATTRIBUTES = new Set<string>([...PROV_ATTRIBUTE_QNAMES, ...PROV_ATTRIBUTE_LITERALS]);
```

### Record equality & the attribute "set-of-pairs" semantics

`ProvRecord.__eq__` (`model.py:528-536`): equal iff `getType()` equal, identifier equal *only when self has one* (the asymmetric blank-id rule), and **`set(self.attributes) == set(other.attributes)`** — a multiset-without-duplicates over `(name, value)` pairs. Duplicate identical pairs collapse; equality is order-independent.

```ts
// record/record.ts
equals(other: unknown): boolean {
  if (!(other instanceof ProvRecord)) return false;
  if (!this.getType().equals(other.getType())) return false;
  // asymmetric: only compare ids if THIS has one (model.py:533)
  if (this.identifier && !this.identifier.equals(other.identifier)) return false;
  return setEqual(this.attributeKeySet, other.attributeKeySet);  // canonical (name|value) keys
}

/** the canonical multiset key for the record — replaces hash((type, id, frozenset(attributes))). */
get key(): string {
  const attrKeys = [...this.attributeKeySet].sort().join("\u0001");   // order-independent
  return `${this.getType().uri}\u0000${this.identifier?.uri ?? ""}\u0000${attrKeys}`;
}

/** Set<string> of 'attrQName.uri \0 valueKey' — dedups identical pairs like Python set(). */
private get attributeKeySet(): Set<string> {
  const s = new Set<string>();
  for (const [name, value] of this.attributes) s.add(`${name.uri}\u0000${valueKey(value)}`);
  return s;
}
```

`valueKey(v)` maps any attribute value to a stable string: `QualifiedName.key` / `Literal.key` / `Identifier.key` / `toXsdDateTime(dt)` / `String(number)` / `String(boolean)`. **This is the function that makes the whole library correct.** Every dedup, every equality, every Set membership goes through it.

### Bundle equality — keep the O(n²) multiset match

`ProvBundle.__eq__` (`model.py:1619`) builds `set(records)`, checks counts, then greedily matches-and-removes. Because our record `key` is content-based, we can bucket by `key`:

```ts
// bundle.ts
equals(other: ProvBundle): boolean {
  const a = this.getRecords(), b = other.getRecords();
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const r of a) counts.set(r.key, (counts.get(r.key) ?? 0) + 1);
  for (const r of b) {
    const c = counts.get(r.key); if (!c) return false;
    counts.set(r.key, c - 1);
  }
  return true;   // O(n) instead of Python's O(n²); behaviorally identical
}
```

> **`ProvBundle`/`ProvDocument` are intentionally non-hashable** (`__hash__ = None`, `model.py:1646`). In TS: never use a bundle/document as a `Map`/`Set` key. Expose only `equals()`. This is just a discipline, not a type.

> **`NamespaceManager._renameMap` keys on `Namespace` objects** (`model.py`). Since JS keys by reference, key it by `Namespace.key` (`prefix\0uri`) instead — a `Map<string, Namespace>`.

---

## 7. Serializers in TypeScript

### 7.1 Redesign the contract — drop `io.IOBase`

Python's `Serializer` is the abstract base (`serializers/__init__.py:16`); each concrete serializer takes an `io.IOBase` stream and branches on `TextIOBase` vs binary (e.g. `provn.py:25-29`). There is no `IOBase` in TS, and a library should not own file I/O. **Recommendation: the serializer returns a value; the document owns the format dispatch.**

```ts
// serializers/serializer.ts
export interface Serializer {
  /** Encode a document to text (JSON/N/XML) or bytes (rare). */
  serialize(doc: ProvDocument, opts?: SerializeOpts): string | Uint8Array;
  /** Decode; may throw UnsupportedOperationError for serialize-only formats (PROV-N). */
  deserialize(input: string | Uint8Array, opts?: DeserializeOpts): ProvDocument;
}

// new TS-only design choice — Python's PROV-N deserialize just does `raise NotImplementedError`
// (provn.py:31-32); we give it a named, catchable error instead of porting an existing class.
export class UnsupportedOperationError extends ProvError {}   // PROV-N deserialize (serialize-only)
export class DoNotExist extends ProvError {}                  // unknown format (serializers/__init__.py:49)

// a module-level registry — no lazy-import singleton needed (TS modules don't cycle here)
const REGISTRY = new Map<string, () => Serializer>();
export function registerSerializer(name: string, make: () => Serializer) { REGISTRY.set(name, make); }
export function getSerializer(name: string): Serializer {
  const make = REGISTRY.get(name);
  if (!make) throw new DoNotExist(`No serializer for "${name}"`);
  return make();
}
```

`ProvDocument.serialize(format)` returns a `string` (or `Uint8Array` for binary RDF/graphviz). Callers persist it themselves (`Bun.write(path, doc.serialize('json'))`). This is browser-safe, removes the tempfile/`shutil.move` dance (`model.py:2744`), and is simpler than the stream-vs-path branching.

### 7.2 Sync vs async

**Serialize/deserialize are pure CPU — keep them synchronous.** Async belongs only at the I/O edge (`read(source)` reading a file or URL, §9). Forcing `await doc.serialize()` would be gratuitous. So: `serialize`/`deserialize` sync; `read`/`fromFile`/`fromUrl` async.

### 7.3 PROV-JSON via native `JSON`

Python uses `json.JSONEncoder`/`Decoder` subclass hooks (`provjson.py:100/108`). TS has no such hook — and doesn't need one. We do an explicit **document → plain object** mapping then `JSON.stringify`, and `JSON.parse` then **plain object → document**:

```ts
// serializers/json.ts
export class ProvJsonSerializer implements Serializer {
  serialize(doc: ProvDocument): string {
    return JSON.stringify(encodeJsonDocument(doc), null, 2);   // pure function, no input mutation
  }
  deserialize(input: string | Uint8Array): ProvDocument {
    const text = typeof input === "string" ? input : new TextDecoder().decode(input);
    return decodeJsonDocument(JSON.parse(text));               // copy-first, never mutate the parsed obj
  }
}
registerSerializer("json", () => new ProvJsonSerializer());
```

Two corpus-critical behaviors to reproduce exactly (else PROV-JSON conformance fails — see `tests/test_model.py` `TestLoadingProvToolboxJSON`, 398 golden files):

- the **singleton-or-list collapse** when two records share an id (`provjson.py:178-189`) — decode discriminates with `Array.isArray(x)`, not `hasattr(x,'items')`.
- the **membership HACK**: a `hadMember` with multiple entities fans out into N membership relations on decode (`provjson.py:244-293`).

And **never mutate inputs** — Python does `del content['bundle']`/`del jc['prefix']` (`provjson.py:198/216`); we copy first.

### 7.4 PROV-N text emitter (serialize-only)

Trivial and high-value: it just calls `document.getProvN()` (`provn.py`). Deserialize throws our `UnsupportedOperationError` (Python does a bare `raise NotImplementedError`, `provn.py:31-32`). The real work is `getProvN` on the records — preserve formatting *exactly*: triple-quoted multiline strings, `%g` floats, `%i` bools, ` %% datatype` suffixes, `-` placeholders, the `id; ` relation prefix (`relation_id = identifier + "; "`, `model.py:557`; value encoding `model.py:132`). No `printf` in TS, so small helpers:

```ts
// datetime.ts / format.ts
export function formatFloatG(n: number): string {        // mimic C %g (model.py:140)
  // %g: shortest of %e/%f with up to 6 significant digits, trailing zeros trimmed
  return /* … vetted %g implementation … */;
}
export function encodingProvnValue(v: AttrValue): string {  // model.py:132
  if (typeof v === "string") return quoteMaybeMultiline(v);
  if (v instanceof DateTime || v instanceof Date) return `"${toXsdDateTime(v)}" %% xsd:dateTime`;
  if (typeof v === "number") return `"${formatFloatG(v)}" %% xsd:float`;   // bare number → float
  if (typeof v === "boolean") return `"${v ? 1 : 0}" %% xsd:boolean`;
  return String(v);
}
```

> The `%g` implementation is a known footgun (`tests/examples.py` `datatypes`/`long_literals` pin exact PROV-N output). Budget a focused unit test against the golden PROV-N strings.

### 7.5 Gating XML and RDF

Per `03-dependency-analysis.md`: XML → `@xmldom/xmldom` (DOM, browser-safe; replace `xpath('//comment()')` with a `childNodes` filter), RDF → `n3` (`Parser`/`Writer`/`Store`, first-class TriG/named-graph support). Both are **optional subpath modules** (`tsprov/xml`, `tsprov/rdf`) that self-register on import:

```ts
import "tsprov/rdf";                       // side-effect import registers the "rdf" serializer
import { ProvDocument } from "tsprov";
const ttl = doc.serialize("rdf", { rdfFormat: "turtle" });
```

This keeps the core dependency-free and tree-shakeable. XML round-trip is **known-lossy** (PROV-XML is one-way for some inputs, `tests/test_xml.py:406` disables naive round-trip); validate it against the curated `example_06/07/08.xml` via a c14n diff, not byte equality. RDF has a declared lossy set (scruffy duplicate-id, literal-sets) marked `@expectedFailure` in Python (`tests/test_rdf.py:104`); reproduce that as a named exclusion set, not as bugs.

> **XML and RDF `deserialize` are real and non-trivial.** Unlike PROV-N (whose `deserialize` is a one-line stub raising `NotImplementedError`, `provn.py:31-32`), both XML (`provxml.py:234`) and RDF (`provrdf.py:158`) implement full parsers. That parsing work — not just emitting — is precisely why both rate **Hard, optional** below; budget for the decode path, not only the encode path.

> **Departure from Python's eager serializer coupling — flag it, don't sell it as a clean port.** Python's `Registry.load_serializers()` eagerly imports **all four** serializers together (`serializers/__init__.py:62-74`), so the moment any format is touched the JSON serializer transitively pulls in the `rdflib`/`lxml` imports at registry-init time. The proposed tree-shakeable subpath design (`tsprov/xml`, `tsprov/rdf` self-registering on explicit import) is therefore a **deliberate redesign**, not a faithful transliteration of Python's coupled registry — it is the seam that delivers the dependency-free core.

---

## 8. Datetime & XSD values

PROV times must round-trip **byte-for-byte** across JSON/XML/RDF, which means preserving the UTC offset and sub-second precision exactly. Python uses `dateutil.parser.parse` (lenient ISO-8601, tz-aware) and re-emits `value.isoformat()` (`model.py:67/74`; `value.isoformat()` in `encoding_provn_value`, `model.py:138`, and in `get_provn`, `model.py:565-567`).

| Option | Verdict |
|---|---|
| **native `Date`** | ❌ drops offset (normalizes to local/UTC) and sub-second nuance; no gYear/gYearMonth. Spike-only. |
| **`Temporal`** (polyfill today, native later) | ✅ precise ISO parsing; but `Instant` normalizes to UTC (offset-preservation differs) and it's verbose. Good long-term, more friction now. |
| **`luxon`** (recommended) | ✅ `DateTime.fromISO(s, { setZone: true })` **preserves the source offset**; `.toISO()` reproduces `isoformat()`; TS-native, immutable, browser-safe. |

**Recommendation: luxon, behind a one-file `datetime.ts` facade** mirroring `_ensure_datetime`/`parse_xsd_datetime`:

```ts
// datetime.ts
import { DateTime } from "luxon";

export function ensureDateTime(v: string | Date | DateTime | null): DateTime | null {  // model.py:65
  if (v == null) return null;
  if (v instanceof DateTime) return v;
  if (v instanceof Date) return DateTime.fromJSDate(v);
  const dt = DateTime.fromISO(v, { setZone: true });     // PRESERVE offset (the load-bearing flag)
  if (!dt.isValid) throw new Error(`Invalid datetime: ${v}`);
  return dt;
}
export function parseXsdDateTime(s: string): DateTime | null {   // model.py:72 — null on failure
  const dt = DateTime.fromISO(s, { setZone: true });
  return dt.isValid ? dt : null;
}
export function toXsdDateTime(dt: DateTime | Date): string {     // == isoformat()
  return (dt instanceof DateTime ? dt : DateTime.fromJSDate(dt)).toISO({ suppressMilliseconds: false })!;
}
// gYear / gYearMonth: parse then reformat manually (provrdf.py:222-226)
```

The internal time type is `luxon.DateTime`. The authoring API accepts `Date | string | DateTime` (`DateLike`) and funnels through `ensureDateTime`. **`ProvActivity.setTime` bypasses coercion in Python** (`model.py:802` stores raw) — we preserve that quirk but document it; everything via `add_attributes` is parsed/validated.

---

## 9. Async, I/O, and dual targets

The convenience entry `read(source, format?)` (`__init__.py:23`) auto-detects format by probing serializers (`for format in serializers:` at `__init__.py:47`, `for/else` + bare `except: pass` at `__init__.py:50-52`, `else: raise TypeError` at `__init__.py:53`). The TS version is async at the I/O edge and sync for the in-memory probe:

```ts
// index.ts
export async function read(source: string | URL | Uint8Array, format?: string): Promise<ProvDocument> {
  const text = await loadSource(source);                 // I/O edge — async
  if (format) return getSerializer(format).deserialize(text);
  for (const name of REGISTRY.keys()) {                  // probing order = registration order
    try { return getSerializer(name).deserialize(text); }
    catch { /* intentionally swallow, like bare except: pass (__init__.py:50-52) */ }
  }
  throw new TypeError("Could not deserialize: no registered format matched.");
}

async function loadSource(src: string | URL | Uint8Array): Promise<string> {
  if (src instanceof Uint8Array) return new TextDecoder().decode(src);
  if (src instanceof URL || /^https?:\/\//.test(src)) {
    return await (await fetch(src)).text();              // browser + Bun + Node 18+
  }
  // local path — Bun preferred per CLAUDE.md; node fallback only in the node build
  return await Bun.file(src).text();
}
```

**Dual targets.** The core is environment-agnostic (no `node:fs`, no `node:buffer`):
- **Browser**: `fetch` + `TextEncoder`/`TextDecoder` + `btoa`/`atob` (RDF base64, `provrdf.py:215`) — all global.
- **Bun/Node**: `Bun.file`/`Bun.write` (per CLAUDE.md); a thin `node:fs` fallback only inside the CLI/node entry, never in core.
- **ESM/CJS**: already wired in `package.json` (`bun build` ESM+CJS, `tsc` for `.d.ts`, `exports` map). `verbatimModuleSyntax` enforces clean `import type` usage so the dual build stays honest.

Keep `loadSource`'s `Bun.file` branch in a tiny adapter so the browser bundle tree-shakes it out (it's only reachable via a string-path, which a browser caller won't pass).

---

## 10. Testing strategy & golden fixtures

The Python test suite **is the specification** (`01-codebase-analysis.md` §tests): value-based equality is the whole oracle, backed by large checked-in golden corpora that mirror the test methods 1:1. We reuse them as differential oracles.

**Copy the corpora verbatim** into the TS repo (frozen):
- `tests/json/` (398 PROV-JSON files), `tests/rdf/` (398 `.ttl` + 4 `.trig`), `tests/xml/` (45), `tests/unification/` (9).

**Primary differential test (timestamp-safe):** parse a golden, re-serialize, deep-equal to the *parsed* object — the `TestLoadingProvToolboxJSON` pattern. It avoids the non-deterministic `datetime.now()` problem entirely because it never regenerates fixtures:

```ts
// tests/json-corpus.test.ts
import { test, expect } from "bun:test";
import { ProvDocument } from "tsprov";

for (const file of jsonGoldenFiles()) {
  test(`round-trip ${file}`, async () => {
    const original = await Bun.file(file).text();
    const doc  = ProvDocument.deserialize(original, "json");
    const doc2 = ProvDocument.deserialize(doc.serialize("json"), "json");
    expect(doc.equals(doc2)).toBe(true);                 // value-equality is the oracle
  });
}
```

**Port the `*Base` mixins as data-driven tables.** Python composes ~300 tests via multiple-inheritance mixins (`AllTestsBase`, `tests/test_model.py:229`). TS has no test mixins — flatten to `it.each`/loops over `{name, build()}` arrays. The 28-value `attribute_values` matrix (`tests/attributes.py`) and the ~140 statement constructors (`tests/statements.py`) become arrays/closures driven through each format.

**Freeze the clock** for any fixture using `now()` (or, better, follow Python and self-compare in memory rather than against a checked-in golden — never compare a `now()`-doc to a frozen golden).

**Cross-format:** load `json/X.json`, serialize to PROV-N/RDF, compare RDF via **graph isomorphism** (port `find_diff`, use `n3` to parse both sides) — never string-equality on RDF/XML. Reproduce Python's positional skip lists as **filename-keyed** exclusion sets (convert the `sorted(glob(...))` indices to names once, so they're stable).

**`primer_example` vs `primer_example_alternate`** (fluent vs document-method builder, `tests/examples.py`) must build equal docs — a perfect first end-to-end test of the value-equality implementation (§6).

---

## 11. Public API sketch

```ts
// src/index.ts — the public barrel (core only; xml/rdf/graph/dot are subpath exports)
export { ProvDocument } from "./document.ts";
export { ProvBundle } from "./bundle.ts";
export {
  ProvRecord, ProvElement, ProvRelation,
  ProvEntity, ProvActivity, ProvAgent,
  ProvGeneration, ProvUsage, ProvCommunication, ProvStart, ProvEnd,
  ProvInvalidation, ProvDerivation, ProvAttribution, ProvAssociation,
  ProvDelegation, ProvInfluence, ProvSpecialization, ProvAlternate,
  ProvMention, ProvMembership,
} from "./record/index.ts";
export { Identifier, QualifiedName, Namespace } from "./identifier.ts";
export { Literal } from "./literal.ts";
export { NamespaceManager } from "./namespace-manager.ts";
export { ProvError, ProvException, ProvElementIdentifierRequired } from "./error.ts";
export {
  PROV, XSD, XSI,
  PROV_ENTITY, PROV_ACTIVITY, PROV_AGENT, /* … type QNames … */
  XSD_STRING, XSD_INT, XSD_LONG, XSD_DOUBLE, XSD_FLOAT, XSD_BOOLEAN, XSD_DATETIME, XSD_ANYURI,
} from "./constants.ts";
export { read } from "./read.ts";
export type { ProvAttributes, AttrValue, DateLike, EntityRef, ActivityRef, AgentRef } from "./types.ts";

// register the always-available serializers (tree-shake-safe: pure registration)
import "./serializers/json.ts";
import "./serializers/provn.ts";
```

End-to-end, showcasing the DX (autocomplete, typed refs, fluent chain, format dispatch):

```ts
import { ProvDocument, Literal, XSD_INT } from "tsprov";

const d = new ProvDocument();
d.addNamespace("ex", "http://example.org/");

const dataset = d.entity("ex:dataset", { "prov:type": "ex:Dataset", "ex:rows": new Literal(10_000, XSD_INT) });
const clean   = d.activity("ex:clean", "2024-06-18T09:00:00+01:00");
const analyst = d.agent("ex:bob", { "foaf:name": "Bob" });

dataset
  .wasGeneratedBy(clean, "2024-06-18T09:30:00+01:00")    // ProvActivity arg type-checked
  .wasAttributedTo(analyst);
d.wasAssociatedWith(clean, analyst, undefined, { attributes: { "prov:role": "operator" } });

console.log(d.serialize("provn"));                       // PROV-N text
const json = d.serialize("json");                        // PROV-JSON
const back = ProvDocument.deserialize(json, "json");
console.log(d.equals(back));                             // true — value equality (§6)
```

---

## 12. Feasibility verdict & risks

**Overall: feasible and worthwhile.** The core (~5,500 LOC) ports to idiomatic TS with *better* DX (type-safe relations, real autocomplete) and broader reach (browser-safe, tree-shakeable) than the Python original. The risk is concentrated in two places: the equality/hashing rework (§6) and the heavy serializers (RDF/XML). Everything else is mechanical.

| Subsystem | Feasibility | Why / key risk |
|---|---|---|
| `identifier` (Identifier/QName/Namespace) | **Easy** | clean value classes; the only subtlety is the key/hash asymmetry — handled by `key` getters (§3.1) |
| `constants` (QNames, maps) | **Easy** | string-keyed `Map`/`Set` once interning is in place (§6) |
| `literal` + XSD | **Moderate** | int/double collapse → carry datatype on value; tri-state boolean must not collapse to truthiness |
| `record` hierarchy | **Moderate** | classes map 1:1; `add_attributes` single-valued rule (`model.py:505`) is fiddly; `defaultdict` read-mutation deliberately dropped |
| `namespace-manager` | **Moderate** | dict-subclassing → composition; `valid_qualified_name` deep branching + identity-vs-equality (`model.py:1262`); `add_namespace` returns substituted ns |
| `bundle` / `document` (authoring API) | **Moderate** | mostly mechanical; copy-vs-mutate quirks (`flattened` returns self, `unified` shares NS manager) must be preserved or consciously changed |
| `serializers/json` + `provn` | **Moderate** | membership HACK + singleton/list collapse + exact PROV-N `%g`/`%%` formatting |
| equality / hashing (cross-cutting) | **Hard** | **the central risk** — value semantics under reference-keyed `Map`/`Set`; mitigated by canonical `key` + intern + `equals()`, validated by the golden corpus |
| `serializers/xml` | **Hard, optional** | no lxml; `@xmldom/xmldom` + manual nsmap/c14n; known-lossy round-trip — gate it, test via c14n diff |
| `serializers/rdf` | **Hard, optional** | 760 LOC, deeply nested predicate remapping; `n3` + DataFactory; drive by conformance corpus, not re-derivation |
| `graph` / `dot` | **Easy–Moderate, optional** | tiny surface; hand-roll MultiDiGraph or `graphology`; emit DOT via `ts-graphviz`; defer |
| `cli` (convert/compare) | **Easy** | thin glue; `util.parseArgs`; preserve 0/1/2 exit-code contract |

**Top risks & unknowns (ranked):**

1. **Value-equality fidelity (§6).** If `valueKey`/`record.key`/`equals` diverge from Python's hash/eq even slightly (e.g. number formatting, langtag handling, the asymmetric blank-id rule at `model.py:533`), the entire golden-corpus oracle silently disagrees. *Mitigation:* land §6 first, test against `tests/json/` (398 files) before building serializers.
2. **int vs double round-trips.** JS `number` cannot distinguish `1` from `1.0`; the JSON/RDF encoders depend on it. *Mitigation:* carry datatype on values (`Literal`), default bare numbers to `xsd:double` (matches `float` default), require explicit `Literal(n, XSD_INT)` for ints — and verify against the attribute matrix.
3. **Datetime offset/precision preservation.** Byte-equivalent serialization needs the source UTC offset and sub-second digits intact. *Mitigation:* luxon with `{ setZone: true }`, centralized facade, unit-test `isoformat` parity.
4. **RDF/XML semantic complexity.** The RDF `encode_container` (`provrdf.py:261`) is the hardest single function in the codebase. *Mitigation:* treat both as optional, ship JSON+PROV-N first, drive RDF/XML purely by the golden corpus + isomorphism comparison, and import Python's known-lossy exclusion sets verbatim.
5. **PROV-N `%g`/escaping exactness.** No native `printf`. *Mitigation:* a vetted `%g` helper unit-tested against the `datatypes`/`long_literals`/`TestLiteralRepresentation` golden strings.

**Recommended build order** (aligns with `02-migration-roadmap.md`): `intern`/`identifier`/`constants` → `literal`/`datetime` → `record` (+ `AttributeStore`, equality) → `namespace-manager` → `bundle`/`document` → `serializers/json` + `provn` → wire the golden-corpus differential tests → then, optional and gated: `xml`, `rdf`, `graph`, `dot`, `cli`.
