// `ProvBundle` — a named set of PROV records plus the fluent authoring API.
//
// Port of `ProvBundle` (model.py:1373). Holds a `NamespaceManager`, an ordered
// record list, and an id→records map. **Implements `RecordBundle`** (the resolver
// seam the record layer deferred through M3): `validQualifiedName` /
// `mandatoryValidQname` delegate to the NamespaceManager.
//
// Naming inversion (DEVIATIONS): the camelCase PROV vocabulary (`wasGeneratedBy`,
// `wasDerivedFrom`, …) is the **primary** API; Python's descriptive names
// (`generation`, `derivation`, …) are kept as aliases. (Python is the reverse,
// model.py:2479.)

import { NamespaceManager, type NamespaceCollection } from "./namespace-manager";
import { Namespace, type QualifiedName } from "./identifier";
import {
  ProvRecord,
  type RecordBundle,
  type ProvAttributes,
  type QualifiedNameCandidate,
  normalizeAttributes,
} from "./record/record";
import { getRecordClass } from "./record/registry";
// Side-effect imports: loading these modules runs their `registerRecordClass`
// calls, which `newRecord` depends on. Bare imports are never elided, unlike the
// type-only imports of the same classes below.
import "./record/element";
import "./record/relation";
import type { ProvEntity, ProvActivity, ProvAgent } from "./record/element";
import type {
  ProvGeneration,
  ProvUsage,
  ProvCommunication,
  ProvStart,
  ProvEnd,
  ProvInvalidation,
  ProvDerivation,
  ProvAttribution,
  ProvAssociation,
  ProvDelegation,
  ProvInfluence,
  ProvSpecialization,
  ProvAlternate,
  ProvMention,
  ProvMembership,
} from "./record/relation";
// Type-only: lets `isDocument` narrow `this`/a bundle ref to `ProvDocument` at the
// call site. Erased at compile time, so it adds no runtime edge to `document.ts`
// (which value-imports `ProvBundle` from here).
import type { ProvDocument } from "./document";
import { ProvException } from "./error";
import { ensureDateTime, type DateLike } from "./datetime";
import {
  PROV_ENTITY,
  PROV_ACTIVITY,
  PROV_AGENT,
  PROV_GENERATION,
  PROV_USAGE,
  PROV_COMMUNICATION,
  PROV_START,
  PROV_END,
  PROV_INVALIDATION,
  PROV_DERIVATION,
  PROV_ATTRIBUTION,
  PROV_ASSOCIATION,
  PROV_DELEGATION,
  PROV_INFLUENCE,
  PROV_SPECIALIZATION,
  PROV_ALTERNATE,
  PROV_MENTION,
  PROV_MEMBERSHIP,
  PROV_REVISION,
  PROV_QUOTATION,
  PROV_PRIMARY_SOURCE,
  PROV_COLLECTION,
  PROV_ATTR_ENTITY,
  PROV_ATTR_ACTIVITY,
  PROV_ATTR_TIME,
  PROV_ATTR_STARTTIME,
  PROV_ATTR_ENDTIME,
  PROV_ATTR_TRIGGER,
  PROV_ATTR_STARTER,
  PROV_ATTR_ENDER,
  PROV_ATTR_INFORMED,
  PROV_ATTR_INFORMANT,
  PROV_ATTR_AGENT,
  PROV_ATTR_PLAN,
  PROV_ATTR_DELEGATE,
  PROV_ATTR_RESPONSIBLE,
  PROV_ATTR_INFLUENCEE,
  PROV_ATTR_INFLUENCER,
  PROV_ATTR_GENERATED_ENTITY,
  PROV_ATTR_USED_ENTITY,
  PROV_ATTR_GENERATION,
  PROV_ATTR_USAGE,
  PROV_ATTR_SPECIFIC_ENTITY,
  PROV_ATTR_GENERAL_ENTITY,
  PROV_ATTR_ALTERNATE1,
  PROV_ATTR_ALTERNATE2,
  PROV_ATTR_BUNDLE,
  PROV_ATTR_COLLECTION,
} from "./constants";

/**
 * A reference to an entity: an entity record or a name candidate. (Aliased
 * per-role for documentation; distinctness is not yet enforced at the type
 * level — a future branded-ref refinement.)
 */
export type EntityRef = ProvRecord | QualifiedNameCandidate;
/** A reference to an activity (see {@link EntityRef}). */
export type ActivityRef = ProvRecord | QualifiedNameCandidate;
/** A reference to an agent (see {@link EntityRef}). */
export type AgentRef = ProvRecord | QualifiedNameCandidate;

/**
 * A {@link ProvRecord} subclass constructor — the filter accepted by
 * {@link ProvBundle.getRecords}. May be abstract (e.g. {@link ProvElement}), since it
 * is used only as the right operand of `instanceof`, never invoked.
 */
// `any[]` args: the constructor is never called here, only `instanceof`-tested, so
// the parameter types are irrelevant and this accepts every record class.
export type RecordClass<T extends ProvRecord = ProvRecord> = abstract new (
  ...args: any[]
) => T;

/**
 * The instance type a {@link RecordClass} constructs. Distributes over a union of
 * classes, so an array of filters yields the union of their instance types.
 */
export type RecordInstance<C> = C extends RecordClass<infer T> ? T : never;

/** A named set of PROV records plus the fluent authoring API (`model.py:1373`). */
export class ProvBundle implements RecordBundle {
  // Mutable (not readonly): `ProvDocument.addBundle` rewrites a bundle's
  // identifier/document and links its namespace manager (`model.py:2671-2682`),
  // and `ProvDocument.unified` shares the namespace manager.
  protected _identifier: QualifiedName | null;
  protected _namespaces: NamespaceManager;
  protected _document: ProvBundle | null;
  protected readonly _records: ProvRecord[] = [];
  /** `identifier.uri` → records with that identifier (`model.py:1396`). */
  protected readonly _idMap = new Map<string, ProvRecord[]>();

  /**
   * @param records    Optional records to seed the bundle.
   * @param identifier Optional bundle identifier.
   * @param namespaces Optional namespaces to register.
   * @param document   Optional parent document (links the namespace managers).
   */
  constructor(
    records?: Iterable<ProvRecord> | null,
    identifier?: QualifiedName | null,
    namespaces?: NamespaceCollection | null,
    document?: ProvBundle | null,
  ) {
    this._identifier = identifier ?? null;
    this._document = document ?? null;
    this._namespaces = new NamespaceManager(
      namespaces ?? null,
      null,
      document ? document._namespaces : null,
    );
    if (records) {
      for (const record of records) {
        this.addRecord(record);
      }
    }
  }

  /** The bundle's identifier, or `null`. */
  get identifier(): QualifiedName | null {
    return this._identifier;
  }

  /** A shallow copy of the bundle's records (`model.py:1443`). */
  get records(): ProvRecord[] {
    return [...this._records];
  }

  /** The parent document, if any. */
  get document(): ProvBundle | null {
    return this._document;
  }

  /** The registered (user-added) namespaces (`model.py:1408`). */
  get namespaces(): Namespace[] {
    return this._namespaces.getRegisteredNamespaces();
  }

  /** The default-namespace URI, if set (`model.py:1417`). */
  get defaultNsUri(): string | null {
    return this._namespaces.getDefaultNamespace()?.uri ?? null;
  }

  /** Sets the default namespace by URI (`model.py:1451`). */
  setDefaultNamespace(uri: string): void {
    this._namespaces.setDefaultNamespace(uri);
  }

  /** The default namespace, or `null`. */
  getDefaultNamespace(): Namespace | null {
    return this._namespaces.getDefaultNamespace();
  }

  /**
   * Registers a namespace, returning the effective one. Accepts a `Namespace`,
   * or a `(prefix, uri)` pair (`model.py:1467`).
   *
   * @param namespaceOrPrefix A namespace, or a prefix string (with `uri`).
   * @param uri Required when a prefix string is given.
   */
  addNamespace(namespaceOrPrefix: Namespace, uri?: undefined): Namespace;
  addNamespace(prefix: string, uri: string): Namespace;
  addNamespace(namespaceOrPrefix: Namespace | string, uri?: string): Namespace {
    if (typeof namespaceOrPrefix !== "string") {
      return this._namespaces.addNamespace(namespaceOrPrefix);
    }
    if (uri === undefined) {
      throw new ProvException("Cannot add a namespace without a URI");
    }
    return this._namespaces.addNamespace(new Namespace(namespaceOrPrefix, uri));
  }

  /** All registered namespaces. */
  getRegisteredNamespaces(): Namespace[] {
    return this._namespaces.getRegisteredNamespaces();
  }

  /**
   * @internal Re-parents this bundle's namespace manager. Used by
   * `ProvDocument.addBundle` (TS forbids a subclass touching a base instance's
   * protected fields directly).
   */
  _setNamespaceParent(parent: NamespaceManager): void {
    this._namespaces.parent = parent;
  }

  /** @internal Rewrites the identifier and sets the owning document. Used by `ProvDocument.addBundle`. */
  _attachToDocument(document: ProvBundle, identifier: QualifiedName): void {
    this._identifier = identifier;
    this._document = document;
  }

  /** Resolves a candidate to a {@link QualifiedName}, or `null` (`RecordBundle`). */
  validQualifiedName(identifier: QualifiedNameCandidate): QualifiedName | null {
    return this._namespaces.validQualifiedName(identifier);
  }

  /** Resolves a candidate to a {@link QualifiedName}, throwing on failure (`model.py:1501`). */
  mandatoryValidQname(identifier: QualifiedNameCandidate): QualifiedName {
    const valid = this.validQualifiedName(identifier);
    if (valid === null) {
      throw new ProvException(`Invalid Qualified Name: ${String(identifier)}`);
    }
    return valid;
  }

  /** Narrows to {@link ProvDocument} (overridden there to return `true`). */
  isDocument(): this is ProvDocument {
    return false;
  }

  // Not a `this is ProvBundle` guard: `ProvDocument` *extends* `ProvBundle` yet
  // returns `false` here (a document is not a *plain* bundle, `model.py:2549`), so a
  // structural predicate would be unsound. This stays a semantic boolean.
  /** True for a plain (non-document) bundle. */
  isBundle(): boolean {
    return true;
  }

  /** True if this contains sub-bundles; overridden in `ProvDocument`. */
  hasBundles(): boolean {
    return false;
  }

  /** All records (`model.py:1514`). */
  getRecords(): ProvRecord[];
  /**
   * Records of a given subclass, narrowed to that type (`model.py:1527`).
   *
   * @param filter A record class, or an array of them, to keep (Python's
   *   `isinstance(rec, class_or_type_or_tuple)`).
   * @returns Only the records that are instances of `filter`, typed as such.
   */
  getRecords<C extends RecordClass>(filter: C | readonly C[]): RecordInstance<C>[];
  getRecords(
    filter?: RecordClass | readonly RecordClass[],
  ): ProvRecord[] {
    if (filter === undefined) {
      return [...this._records];
    }
    // `instanceof` makes the narrowing sound — no asserted cast needed.
    const classes = typeof filter === "function" ? [filter] : filter;
    return this._records.filter((r) => classes.some((cls) => r instanceof cls));
  }

  /** The records matching an identifier (`model.py:1532`). */
  getRecord(identifier: QualifiedNameCandidate): ProvRecord[] {
    const validId = this.validQualifiedName(identifier);
    if (validId === null) {
      return [];
    }
    return [...(this._idMap.get(validId.uri) ?? [])];
  }

  /** Bundle value equality: set-equality of records by their canonical key (`model.py:1619`). */
  equals(other: unknown): boolean {
    if (!(other instanceof ProvBundle)) {
      return false;
    }
    const aKeys = new Set(this.getRecords().map((r) => r.key));
    const bKeys = new Set(other.getRecords().map((r) => r.key));
    if (aKeys.size !== bKeys.size) {
      return false;
    }
    for (const key of aKeys) {
      if (!bKeys.has(key)) {
        return false;
      }
    }
    return true;
  }

  /**
   * The PROV-N representation of this container (`model.py:1576`): a
   * `document … endDocument` or `bundle <id> … endBundle` block listing the
   * default/prefix declarations, the records, and (for a document) the bundles.
   *
   * @param indentLevel Indentation depth (sub-bundles are nested one level in).
   */
  getProvN(indentLevel = 0): string {
    const indentation = "  ".repeat(indentLevel);
    const newline = `\n${"  ".repeat(indentLevel + 1)}`;
    const lines: string[] = this.isDocument()
      ? ["document"]
      : [`bundle ${String(this._identifier)}`];

    const defaultNs = this._namespaces.getDefaultNamespace();
    if (defaultNs) {
      lines.push(`default <${defaultNs.uri}>`);
    }
    const registered = this._namespaces.getRegisteredNamespaces();
    for (const ns of registered) {
      lines.push(`prefix ${ns.prefix} <${ns.uri}>`);
    }
    if (defaultNs || registered.length > 0) {
      lines.push(""); // blank line between declarations and assertions
    }

    for (const record of this._records) {
      lines.push(record.getProvN());
    }
    lines.push(...this.subBundleProvN(indentLevel + 1));

    return `${lines.join(newline)}\n${indentation}${this.isDocument() ? "endDocument" : "endBundle"}`;
  }

  /** PROV-N of nested bundles — empty for a plain bundle; overridden by `ProvDocument`. */
  protected subBundleProvN(_indentLevel: number): string[] {
    return [];
  }

  /** Internal: registers a record, updating the id-map (`model.py:1715`). */
  private addRecordInternal(record: ProvRecord): void {
    const id = record.identifier;
    if (id !== null) {
      const list = this._idMap.get(id.uri);
      if (list) {
        list.push(record);
      } else {
        this._idMap.set(id.uri, [record]);
      }
    }
    this._records.push(record);
  }

  /**
   * Creates and registers a new record (`model.py:1723`). The fluent builders
   * funnel through here.
   *
   * @param recordType      The PROV type QName (a registered record class).
   * @param identifier      The record identifier (or `null`/falsy for none).
   * @param attributes      The formal attributes.
   * @param otherAttributes Extra attributes.
   */
  newRecord(
    recordType: QualifiedName,
    identifier?: QualifiedNameCandidate | null,
    attributes?: ProvAttributes,
    otherAttributes?: ProvAttributes,
  ): ProvRecord {
    const attrList = [
      ...(attributes ? normalizeAttributes(attributes) : []),
      ...(otherAttributes ? normalizeAttributes(otherAttributes) : []),
    ];
    const recordId =
      identifier != null && identifier !== ""
        ? this.validQualifiedName(identifier)
        : null;
    const ctor = getRecordClass(recordType);
    if (ctor === undefined) {
      throw new ProvException(`No record class for type ${String(recordType)}`);
    }
    const record = new ctor(this, recordId, attrList);
    this.addRecordInternal(record);
    return record;
  }

  /** Re-creates `record` inside this bundle (used when seeding records) (`model.py:1760`). */
  addRecord(record: ProvRecord): ProvRecord {
    return this.newRecord(
      record.getType(),
      record.identifier,
      record.formalAttributes,
      record.extraAttributes,
    );
  }

  /** Merges records that share an identifier into one, preserving order (`model.py:1649`). */
  protected unifiedRecords(): ProvRecord[] {
    const mergedByKey = new Map<string, ProvRecord>();
    for (const records of this._idMap.values()) {
      const [first, ...rest] = records;
      if (first === undefined || rest.length === 0) {
        continue; // 0 or 1 record for this id — nothing to merge
      }
      const merged = first.copy();
      for (const record of rest) {
        merged.addAttributes(record.attributes);
      }
      for (const record of records) {
        mergedByKey.set(record.key, merged);
      }
    }
    if (mergedByKey.size === 0) {
      return [...this._records];
    }
    const added = new Set<ProvRecord>();
    const unified: ProvRecord[] = [];
    for (const record of this._records) {
      const merged = mergedByKey.get(record.key);
      if (merged === undefined) {
        unified.push(record);
      } else if (!added.has(merged)) {
        unified.push(merged);
        added.add(merged);
      }
    }
    return unified;
  }

  /** Returns a new bundle with same-identifier records unified (`model.py:1681`). */
  unified(): ProvBundle {
    return new ProvBundle(this.unifiedRecords(), this._identifier);
  }

  /**
   * Appends all of `other`'s records into this bundle (`model.py:1691`).
   *
   * @param other The bundle whose records to append.
   * @throws {ProvException} If `other` is a document carrying sub-bundles.
   */
  update(other: ProvBundle): void {
    if (other.isDocument() && other.hasBundles()) {
      throw new ProvException(
        "ProvBundle.update(): the other bundle is a document with sub-bundle(s).",
      );
    }
    for (const record of other.getRecords()) {
      this.addRecord(record);
    }
  }

  // ── Element builders ──────────────────────────────────────────────────────

  /** Creates a new entity (`model.py:1773`). */
  entity(
    identifier: QualifiedNameCandidate,
    otherAttributes?: ProvAttributes,
  ): ProvEntity {
    return this.newRecord(
      PROV_ENTITY,
      identifier,
      undefined,
      otherAttributes,
    ) as ProvEntity;
  }

  /** Creates a new activity, optionally with start/end times (`model.py:1787`). */
  activity(
    identifier: QualifiedNameCandidate,
    startTime?: DateLike,
    endTime?: DateLike,
    otherAttributes?: ProvAttributes,
  ): ProvActivity {
    return this.newRecord(
      PROV_ACTIVITY,
      identifier,
      [
        [PROV_ATTR_STARTTIME, ensureDateTime(startTime)],
        [PROV_ATTR_ENDTIME, ensureDateTime(endTime)],
      ],
      otherAttributes,
    ) as ProvActivity;
  }

  /** Creates a new agent (`model.py:2018`). */
  agent(
    identifier: QualifiedNameCandidate,
    otherAttributes?: ProvAttributes,
  ): ProvAgent {
    return this.newRecord(
      PROV_AGENT,
      identifier,
      undefined,
      otherAttributes,
    ) as ProvAgent;
  }

  /** Creates a new collection entity (`model.py:2369`). */
  collection(
    identifier: QualifiedNameCandidate,
    otherAttributes?: ProvAttributes,
  ): ProvEntity {
    const record = this.entity(identifier, otherAttributes);
    record.addAssertedType(PROV_COLLECTION);
    return record;
  }

  // ── Relation builders (camelCase primary) ─────────────────────────────────

  /** `wasGeneratedBy` — an entity was generated by an activity (`model.py:1818`). */
  wasGeneratedBy(
    entity: EntityRef,
    activity?: ActivityRef,
    time?: DateLike,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvGeneration {
    return this.newRecord(
      PROV_GENERATION,
      identifier ?? null,
      [
        [PROV_ATTR_ENTITY, entity],
        [PROV_ATTR_ACTIVITY, activity],
        [PROV_ATTR_TIME, ensureDateTime(time)],
      ],
      otherAttributes,
    ) as ProvGeneration;
  }

  /** `used` — an activity used an entity (`model.py:1851`). */
  used(
    activity: ActivityRef,
    entity?: EntityRef,
    time?: DateLike,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvUsage {
    return this.newRecord(
      PROV_USAGE,
      identifier ?? null,
      [
        [PROV_ATTR_ACTIVITY, activity],
        [PROV_ATTR_ENTITY, entity],
        [PROV_ATTR_TIME, ensureDateTime(time)],
      ],
      otherAttributes,
    ) as ProvUsage;
  }

  /** `wasInformedBy` — an activity was informed by another (`model.py:1991`). */
  wasInformedBy(
    informed: ActivityRef,
    informant: ActivityRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvCommunication {
    return this.newRecord(
      PROV_COMMUNICATION,
      identifier ?? null,
      [
        [PROV_ATTR_INFORMED, informed],
        [PROV_ATTR_INFORMANT, informant],
      ],
      otherAttributes,
    ) as ProvCommunication;
  }

  /** `wasStartedBy` — an activity was started by a trigger (`model.py:1884`). */
  wasStartedBy(
    activity: ActivityRef,
    trigger?: EntityRef,
    starter?: ActivityRef,
    time?: DateLike,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvStart {
    return this.newRecord(
      PROV_START,
      identifier ?? null,
      [
        [PROV_ATTR_ACTIVITY, activity],
        [PROV_ATTR_TRIGGER, trigger],
        [PROV_ATTR_STARTER, starter],
        [PROV_ATTR_TIME, ensureDateTime(time)],
      ],
      otherAttributes,
    ) as ProvStart;
  }

  /** `wasEndedBy` — an activity was ended by a trigger (`model.py:1921`). */
  wasEndedBy(
    activity: ActivityRef,
    trigger?: EntityRef,
    ender?: ActivityRef,
    time?: DateLike,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvEnd {
    return this.newRecord(
      PROV_END,
      identifier ?? null,
      [
        [PROV_ATTR_ACTIVITY, activity],
        [PROV_ATTR_TRIGGER, trigger],
        [PROV_ATTR_ENDER, ender],
        [PROV_ATTR_TIME, ensureDateTime(time)],
      ],
      otherAttributes,
    ) as ProvEnd;
  }

  /** `wasInvalidatedBy` — an entity was invalidated by an activity (`model.py:1958`). */
  wasInvalidatedBy(
    entity: EntityRef,
    activity?: ActivityRef,
    time?: DateLike,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvInvalidation {
    return this.newRecord(
      PROV_INVALIDATION,
      identifier ?? null,
      [
        [PROV_ATTR_ENTITY, entity],
        [PROV_ATTR_ACTIVITY, activity],
        [PROV_ATTR_TIME, ensureDateTime(time)],
      ],
      otherAttributes,
    ) as ProvInvalidation;
  }

  /** `wasAttributedTo` — an entity was attributed to an agent (`model.py:2032`). */
  wasAttributedTo(
    entity: EntityRef,
    agent: AgentRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvAttribution {
    return this.newRecord(
      PROV_ATTRIBUTION,
      identifier ?? null,
      [
        [PROV_ATTR_ENTITY, entity],
        [PROV_ATTR_AGENT, agent],
      ],
      otherAttributes,
    ) as ProvAttribution;
  }

  /** `wasAssociatedWith` — an activity was associated with an agent (`model.py:2061`). */
  wasAssociatedWith(
    activity: ActivityRef,
    agent?: AgentRef,
    plan?: EntityRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvAssociation {
    return this.newRecord(
      PROV_ASSOCIATION,
      identifier ?? null,
      [
        [PROV_ATTR_ACTIVITY, activity],
        [PROV_ATTR_AGENT, agent],
        [PROV_ATTR_PLAN, plan],
      ],
      otherAttributes,
    ) as ProvAssociation;
  }

  /** `actedOnBehalfOf` — an agent delegated to another (`model.py:2093`). */
  actedOnBehalfOf(
    delegate: AgentRef,
    responsible: AgentRef,
    activity?: ActivityRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvDelegation {
    return this.newRecord(
      PROV_DELEGATION,
      identifier ?? null,
      [
        [PROV_ATTR_DELEGATE, delegate],
        [PROV_ATTR_RESPONSIBLE, responsible],
        [PROV_ATTR_ACTIVITY, activity],
      ],
      otherAttributes,
    ) as ProvDelegation;
  }

  /** `wasInfluencedBy` — generic influence between two things (`model.py:2125`). */
  wasInfluencedBy(
    influencee: EntityRef,
    influencer: EntityRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvInfluence {
    return this.newRecord(
      PROV_INFLUENCE,
      identifier ?? null,
      [
        [PROV_ATTR_INFLUENCEE, influencee],
        [PROV_ATTR_INFLUENCER, influencer],
      ],
      otherAttributes,
    ) as ProvInfluence;
  }

  /** `wasDerivedFrom` — one entity derived from another (`model.py:2154`). */
  wasDerivedFrom(
    generatedEntity: EntityRef,
    usedEntity: EntityRef,
    activity?: ActivityRef,
    generation?: EntityRef,
    usage?: EntityRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvDerivation {
    return this.newRecord(
      PROV_DERIVATION,
      identifier ?? null,
      [
        [PROV_ATTR_GENERATED_ENTITY, generatedEntity],
        [PROV_ATTR_USED_ENTITY, usedEntity],
        [PROV_ATTR_ACTIVITY, activity],
        [PROV_ATTR_GENERATION, generation],
        [PROV_ATTR_USAGE, usage],
      ],
      otherAttributes,
    ) as ProvDerivation;
  }

  /** `wasRevisionOf` — a derivation asserting `prov:Revision` (`model.py:2191`). */
  wasRevisionOf(
    generatedEntity: EntityRef,
    usedEntity: EntityRef,
    activity?: ActivityRef,
    generation?: EntityRef,
    usage?: EntityRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvDerivation {
    const record = this.wasDerivedFrom(
      generatedEntity,
      usedEntity,
      activity,
      generation,
      usage,
      identifier,
      otherAttributes,
    );
    record.addAssertedType(PROV_REVISION);
    return record;
  }

  /** `wasQuotedFrom` — a derivation asserting `prov:Quotation` (`model.py:2229`). */
  wasQuotedFrom(
    generatedEntity: EntityRef,
    usedEntity: EntityRef,
    activity?: ActivityRef,
    generation?: EntityRef,
    usage?: EntityRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvDerivation {
    const record = this.wasDerivedFrom(
      generatedEntity,
      usedEntity,
      activity,
      generation,
      usage,
      identifier,
      otherAttributes,
    );
    record.addAssertedType(PROV_QUOTATION);
    return record;
  }

  /** `hadPrimarySource` — a derivation asserting `prov:PrimarySource` (`model.py:2267`). */
  hadPrimarySource(
    generatedEntity: EntityRef,
    usedEntity: EntityRef,
    activity?: ActivityRef,
    generation?: EntityRef,
    usage?: EntityRef,
    identifier?: QualifiedNameCandidate | null,
    otherAttributes?: ProvAttributes,
  ): ProvDerivation {
    const record = this.wasDerivedFrom(
      generatedEntity,
      usedEntity,
      activity,
      generation,
      usage,
      identifier,
      otherAttributes,
    );
    record.addAssertedType(PROV_PRIMARY_SOURCE);
    return record;
  }

  /** `specializationOf` — a specific entity specializes a general one (`model.py:2306`). */
  specializationOf(
    specificEntity: EntityRef,
    generalEntity: EntityRef,
  ): ProvSpecialization {
    return this.newRecord(PROV_SPECIALIZATION, null, [
      [PROV_ATTR_SPECIFIC_ENTITY, specificEntity],
      [PROV_ATTR_GENERAL_ENTITY, generalEntity],
    ]) as ProvSpecialization;
  }

  /** `alternateOf` — two entities are alternates (`model.py:2327`). */
  alternateOf(alternate1: EntityRef, alternate2: EntityRef): ProvAlternate {
    return this.newRecord(PROV_ALTERNATE, null, [
      [PROV_ATTR_ALTERNATE1, alternate1],
      [PROV_ATTR_ALTERNATE2, alternate2],
    ]) as ProvAlternate;
  }

  /** `mentionOf` — a specialization within a bundle (`model.py:2346`). */
  mentionOf(
    specificEntity: EntityRef,
    generalEntity: EntityRef,
    bundle: EntityRef,
  ): ProvMention {
    return this.newRecord(PROV_MENTION, null, [
      [PROV_ATTR_SPECIFIC_ENTITY, specificEntity],
      [PROV_ATTR_GENERAL_ENTITY, generalEntity],
      [PROV_ATTR_BUNDLE, bundle],
    ]) as ProvMention;
  }

  /** `hadMember` — an entity is a member of a collection (`model.py:2385`). */
  hadMember(collection: EntityRef, entity: EntityRef): ProvMembership {
    return this.newRecord(PROV_MEMBERSHIP, null, [
      [PROV_ATTR_COLLECTION, collection],
      [PROV_ATTR_ENTITY, entity],
    ]) as ProvMembership;
  }

  // ── Descriptive aliases (Python's primary names) ──────────────────────────
  /** Alias of {@link wasGeneratedBy}. */
  generation = this.wasGeneratedBy;
  /** Alias of {@link used}. */
  usage = this.used;
  /** Alias of {@link wasInformedBy}. */
  communication = this.wasInformedBy;
  /** Alias of {@link wasStartedBy}. */
  start = this.wasStartedBy;
  /** Alias of {@link wasEndedBy}. */
  end = this.wasEndedBy;
  /** Alias of {@link wasInvalidatedBy}. */
  invalidation = this.wasInvalidatedBy;
  /** Alias of {@link wasAttributedTo}. */
  attribution = this.wasAttributedTo;
  /** Alias of {@link wasAssociatedWith}. */
  association = this.wasAssociatedWith;
  /** Alias of {@link actedOnBehalfOf}. */
  delegation = this.actedOnBehalfOf;
  /** Alias of {@link wasInfluencedBy}. */
  influence = this.wasInfluencedBy;
  /** Alias of {@link wasDerivedFrom}. */
  derivation = this.wasDerivedFrom;
  /** Alias of {@link wasRevisionOf}. */
  revision = this.wasRevisionOf;
  /** Alias of {@link wasQuotedFrom}. */
  quotation = this.wasQuotedFrom;
  /** Alias of {@link hadPrimarySource}. */
  primarySource = this.hadPrimarySource;
  /** Alias of {@link specializationOf}. */
  specialization = this.specializationOf;
  /** Alias of {@link alternateOf}. */
  alternate = this.alternateOf;
  /** Alias of {@link mentionOf}. */
  mention = this.mentionOf;
  /** Alias of {@link hadMember}. */
  membership = this.hadMember;
}
