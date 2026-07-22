// PROV and XSD constants: namespaces, type/attribute qualified names, and the
// wiring maps that connect them.
//
// Port of `reference/prov/src/prov/constants.py`. Two fidelity rules drive the
// shape here (see 04-typescript-feasibility §6):
//   1. Every constant is minted through the interned `ns(...).qn(...)`, so the
//      values are process-global singletons — `PROV_ENTITY === PROV.qn("Entity")`.
//   2. Python keys its wiring maps/sets on the QName object (hashed by URI). JS
//      keys by reference, so every such map/set here is keyed by `qn.uri`
//      (a `string`), never by the object.
//
// Where Python derives one map by inverting another (`PROV_RECORD_IDS_MAP` from
// `PROV_N_MAP`, the attribute id maps from `PROV_RECORD_ATTRIBUTES`), we derive
// from a single source-of-truth pair array so the two directions cannot drift.

import { ns } from "./intern.js";
import type { QualifiedName } from "./identifier.js";
// Type-only (erased): brands the record-type QNames with the class each builds, so
// `ProvBundle.newRecord` returns the concrete type with no cast. No runtime cycle —
// the record modules import this one at runtime, never the reverse.
import type { RecordTypeQName } from "./record/registry.js";
import type { ProvEntity, ProvActivity, ProvAgent } from "./record/element.js";
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
  ProvAlternate,
  ProvSpecialization,
  ProvMention,
  ProvMembership,
} from "./record/relation.js";

// ── Namespaces ──────────────────────────────────────────────────────────────

/** The XML Schema namespace (`xsd`). */
export const XSD = ns("xsd", "http://www.w3.org/2001/XMLSchema#");
/** The W3C PROV namespace (`prov`). */
export const PROV = ns("prov", "http://www.w3.org/ns/prov#");
/** The XML Schema Instance namespace (`xsi`). */
export const XSI = ns("xsi", "http://www.w3.org/2001/XMLSchema-instance");

// ── Record type QNames (constants.py:11-37) ─────────────────────────────────

/** `prov:Entity` — PROV-DM Entity element type. */
export const PROV_ENTITY = PROV.qn("Entity") as RecordTypeQName<ProvEntity>;
/** `prov:Activity` — PROV-DM Activity element type. */
export const PROV_ACTIVITY = PROV.qn("Activity") as RecordTypeQName<ProvActivity>;
/** `prov:Generation` — `wasGeneratedBy` relation type. */
export const PROV_GENERATION = PROV.qn("Generation") as RecordTypeQName<ProvGeneration>;
/** `prov:Usage` — `used` relation type. */
export const PROV_USAGE = PROV.qn("Usage") as RecordTypeQName<ProvUsage>;
/** `prov:Communication` — `wasInformedBy` relation type. */
export const PROV_COMMUNICATION = PROV.qn("Communication") as RecordTypeQName<ProvCommunication>;
/** `prov:Start` — `wasStartedBy` relation type. */
export const PROV_START = PROV.qn("Start") as RecordTypeQName<ProvStart>;
/** `prov:End` — `wasEndedBy` relation type. */
export const PROV_END = PROV.qn("End") as RecordTypeQName<ProvEnd>;
/** `prov:Invalidation` — `wasInvalidatedBy` relation type. */
export const PROV_INVALIDATION = PROV.qn("Invalidation") as RecordTypeQName<ProvInvalidation>;
/** `prov:Derivation` — `wasDerivedFrom` relation type. */
export const PROV_DERIVATION = PROV.qn("Derivation") as RecordTypeQName<ProvDerivation>;
/** `prov:Agent` — PROV-DM Agent element type. */
export const PROV_AGENT = PROV.qn("Agent") as RecordTypeQName<ProvAgent>;
/** `prov:Attribution` — `wasAttributedTo` relation type. */
export const PROV_ATTRIBUTION = PROV.qn("Attribution") as RecordTypeQName<ProvAttribution>;
/** `prov:Association` — `wasAssociatedWith` relation type. */
export const PROV_ASSOCIATION = PROV.qn("Association") as RecordTypeQName<ProvAssociation>;
/** `prov:Delegation` — `actedOnBehalfOf` relation type. */
export const PROV_DELEGATION = PROV.qn("Delegation") as RecordTypeQName<ProvDelegation>;
/** `prov:Influence` — `wasInfluencedBy` relation type. */
export const PROV_INFLUENCE = PROV.qn("Influence") as RecordTypeQName<ProvInfluence>;
/** `prov:Bundle` — bundle type. (Unbranded: a bundle is a container, not a `ProvRecord`.) */
export const PROV_BUNDLE = PROV.qn("Bundle");
/** `prov:Alternate` — `alternateOf` relation type. */
export const PROV_ALTERNATE = PROV.qn("Alternate") as RecordTypeQName<ProvAlternate>;
/** `prov:Specialization` — `specializationOf` relation type. */
export const PROV_SPECIALIZATION = PROV.qn("Specialization") as RecordTypeQName<ProvSpecialization>;
/** `prov:Mention` — `mentionOf` relation type (a specialization subtype). */
export const PROV_MENTION = PROV.qn("Mention") as RecordTypeQName<ProvMention>;
/** `prov:Membership` — `hadMember` relation type. */
export const PROV_MEMBERSHIP = PROV.qn("Membership") as RecordTypeQName<ProvMembership>;

// ── Subtype QNames (PROV-N subtypes / asserted types, constants.py:64-72) ────

/** `prov:Revision` — a derivation subtype (`wasRevisionOf`). */
export const PROV_REVISION = PROV.qn("Revision");
/** `prov:Quotation` — a derivation subtype (`wasQuotedFrom`). */
export const PROV_QUOTATION = PROV.qn("Quotation");
/** `prov:PrimarySource` — a derivation subtype (`hadPrimarySource`). */
export const PROV_PRIMARY_SOURCE = PROV.qn("PrimarySource");
/** `prov:SoftwareAgent` — an agent subtype. */
export const PROV_SOFTWARE_AGENT = PROV.qn("SoftwareAgent");
/** `prov:Person` — an agent subtype. */
export const PROV_PERSON = PROV.qn("Person");
/** `prov:Organization` — an agent subtype. */
export const PROV_ORGANIZATION = PROV.qn("Organization");
/** `prov:Plan` — an entity subtype. */
export const PROV_PLAN = PROV.qn("Plan");
/** `prov:Collection` — an entity subtype. */
export const PROV_COLLECTION = PROV.qn("Collection");
/** `prov:EmptyCollection` — an entity subtype. */
export const PROV_EMPTY_COLLECTION = PROV.qn("EmptyCollection");

// ── Formal attribute QNames (QName-valued, constants.py:110-132) ────────────

/** `prov:entity` formal attribute. */
export const PROV_ATTR_ENTITY = PROV.qn("entity");
/** `prov:activity` formal attribute. */
export const PROV_ATTR_ACTIVITY = PROV.qn("activity");
/** `prov:trigger` formal attribute. */
export const PROV_ATTR_TRIGGER = PROV.qn("trigger");
/** `prov:informed` formal attribute. */
export const PROV_ATTR_INFORMED = PROV.qn("informed");
/** `prov:informant` formal attribute. */
export const PROV_ATTR_INFORMANT = PROV.qn("informant");
/** `prov:starter` formal attribute. */
export const PROV_ATTR_STARTER = PROV.qn("starter");
/** `prov:ender` formal attribute. */
export const PROV_ATTR_ENDER = PROV.qn("ender");
/** `prov:agent` formal attribute. */
export const PROV_ATTR_AGENT = PROV.qn("agent");
/** `prov:plan` formal attribute. */
export const PROV_ATTR_PLAN = PROV.qn("plan");
/** `prov:delegate` formal attribute. */
export const PROV_ATTR_DELEGATE = PROV.qn("delegate");
/** `prov:responsible` formal attribute. */
export const PROV_ATTR_RESPONSIBLE = PROV.qn("responsible");
/** `prov:generatedEntity` formal attribute. */
export const PROV_ATTR_GENERATED_ENTITY = PROV.qn("generatedEntity");
/** `prov:usedEntity` formal attribute. */
export const PROV_ATTR_USED_ENTITY = PROV.qn("usedEntity");
/** `prov:generation` formal attribute. */
export const PROV_ATTR_GENERATION = PROV.qn("generation");
/** `prov:usage` formal attribute. */
export const PROV_ATTR_USAGE = PROV.qn("usage");
/** `prov:specificEntity` formal attribute. */
export const PROV_ATTR_SPECIFIC_ENTITY = PROV.qn("specificEntity");
/** `prov:generalEntity` formal attribute. */
export const PROV_ATTR_GENERAL_ENTITY = PROV.qn("generalEntity");
/** `prov:alternate1` formal attribute. */
export const PROV_ATTR_ALTERNATE1 = PROV.qn("alternate1");
/** `prov:alternate2` formal attribute. */
export const PROV_ATTR_ALTERNATE2 = PROV.qn("alternate2");
/** `prov:bundle` formal attribute. */
export const PROV_ATTR_BUNDLE = PROV.qn("bundle");
/** `prov:influencee` formal attribute. */
export const PROV_ATTR_INFLUENCEE = PROV.qn("influencee");
/** `prov:influencer` formal attribute. */
export const PROV_ATTR_INFLUENCER = PROV.qn("influencer");
/** `prov:collection` formal attribute. */
export const PROV_ATTR_COLLECTION = PROV.qn("collection");

// ── Literal-valued formal attributes (constants.py:135-137) ─────────────────

/** `prov:time` literal-valued formal attribute. */
export const PROV_ATTR_TIME = PROV.qn("time");
/** `prov:startTime` literal-valued formal attribute. */
export const PROV_ATTR_STARTTIME = PROV.qn("startTime");
/** `prov:endTime` literal-valued formal attribute. */
export const PROV_ATTR_ENDTIME = PROV.qn("endTime");

// ── Convenience QNames (constants.py:182-189) ───────────────────────────────

/** `prov:type` — the asserted-type attribute. */
export const PROV_TYPE = PROV.qn("type");
/** `prov:label` — the human-readable label attribute. */
export const PROV_LABEL = PROV.qn("label");
/** `prov:value` — the literal value attribute. */
export const PROV_VALUE = PROV.qn("value");
/** `prov:location` — the location attribute. */
export const PROV_LOCATION = PROV.qn("location");
/** `prov:role` — the role attribute. */
export const PROV_ROLE = PROV.qn("role");
/** `prov:QUALIFIED_NAME` — the datatype QName for a PROV qualified-name value. */
export const PROV_QUALIFIEDNAME = PROV.qn("QUALIFIED_NAME");
/** `prov:InternationalizedString` — datatype forced by a literal's language tag. */
export const PROV_INTERNATIONALIZEDSTRING = PROV.qn("InternationalizedString");

// ── XSD datatypes (constants.py:191-216) ────────────────────────────────────

/** `xsd:anyURI`. */
export const XSD_ANYURI = XSD.qn("anyURI");
/** `xsd:QName`. */
export const XSD_QNAME = XSD.qn("QName");
/** `xsd:dateTime`. */
export const XSD_DATETIME = XSD.qn("dateTime");
/** `xsd:time`. */
export const XSD_TIME = XSD.qn("time");
/** `xsd:date`. */
export const XSD_DATE = XSD.qn("date");
/** `xsd:string`. */
export const XSD_STRING = XSD.qn("string");
/** `xsd:boolean`. */
export const XSD_BOOLEAN = XSD.qn("boolean");
/** `xsd:integer`. */
export const XSD_INTEGER = XSD.qn("integer");
/** `xsd:long`. */
export const XSD_LONG = XSD.qn("long");
/** `xsd:int`. */
export const XSD_INT = XSD.qn("int");
/** `xsd:short`. */
export const XSD_SHORT = XSD.qn("short");
/** `xsd:byte`. */
export const XSD_BYTE = XSD.qn("byte");
/** `xsd:nonNegativeInteger`. */
export const XSD_NONNEGATIVEINTEGER = XSD.qn("nonNegativeInteger");
/** `xsd:unsignedLong`. */
export const XSD_UNSIGNEDLONG = XSD.qn("unsignedLong");
/** `xsd:unsignedInt`. */
export const XSD_UNSIGNEDINT = XSD.qn("unsignedInt");
/** `xsd:unsignedShort`. */
export const XSD_UNSIGNEDSHORT = XSD.qn("unsignedShort");
/** `xsd:unsignedByte`. */
export const XSD_UNSIGNEDBYTE = XSD.qn("unsignedByte");
/** `xsd:positiveInteger`. */
export const XSD_POSITIVEINTEGER = XSD.qn("positiveInteger");
/** `xsd:nonPositiveInteger`. */
export const XSD_NONPOSITIVEINTEGER = XSD.qn("nonPositiveInteger");
/** `xsd:negativeInteger`. */
export const XSD_NEGATIVEINTEGER = XSD.qn("negativeInteger");
/** `xsd:float`. */
export const XSD_FLOAT = XSD.qn("float");
/** `xsd:double`. */
export const XSD_DOUBLE = XSD.qn("double");
/** `xsd:decimal`. */
export const XSD_DECIMAL = XSD.qn("decimal");

// ── Wiring maps ─────────────────────────────────────────────────────────────

// Single source of truth for the type ↔ PROV-N-name correspondence; both
// `PROV_N_MAP` and its inverse `PROV_RECORD_IDS_MAP` derive from this.
const PROV_N_PAIRS: ReadonlyArray<readonly [QualifiedName, string]> = [
  [PROV_ENTITY, "entity"],
  [PROV_ACTIVITY, "activity"],
  [PROV_GENERATION, "wasGeneratedBy"],
  [PROV_USAGE, "used"],
  [PROV_COMMUNICATION, "wasInformedBy"],
  [PROV_START, "wasStartedBy"],
  [PROV_END, "wasEndedBy"],
  [PROV_INVALIDATION, "wasInvalidatedBy"],
  [PROV_DERIVATION, "wasDerivedFrom"],
  [PROV_AGENT, "agent"],
  [PROV_ATTRIBUTION, "wasAttributedTo"],
  [PROV_ASSOCIATION, "wasAssociatedWith"],
  [PROV_DELEGATION, "actedOnBehalfOf"],
  [PROV_INFLUENCE, "wasInfluencedBy"],
  [PROV_ALTERNATE, "alternateOf"],
  [PROV_SPECIALIZATION, "specializationOf"],
  [PROV_MENTION, "mentionOf"],
  [PROV_MEMBERSHIP, "hadMember"],
  [PROV_BUNDLE, "bundle"],
];

/** Record type → PROV-N short name, keyed by `qn.uri`. Mirrors `PROV_N_MAP` (constants.py:39). */
export const PROV_N_MAP: ReadonlyMap<string, string> = new Map(
  PROV_N_PAIRS.map(([qn, name]): [string, string] => [qn.uri, name]),
);

/** PROV-N short name → record type QName (inverse of {@link PROV_N_MAP}, constants.py:171). */
export const PROV_RECORD_IDS_MAP: ReadonlyMap<string, QualifiedName> = new Map(
  PROV_N_PAIRS.map(([qn, name]): [string, QualifiedName] => [name, qn]),
);

/**
 * PROV-N names for subtypes that are top-level types in other formats (e.g.
 * PROV-XML), keyed by `qn.uri`. Mirrors `ADDITIONAL_N_MAP` (constants.py:63).
 */
export const ADDITIONAL_N_MAP: ReadonlyMap<string, string> = new Map(
  (
    [
      [PROV_REVISION, "wasRevisionOf"],
      [PROV_QUOTATION, "wasQuotedFrom"],
      [PROV_PRIMARY_SOURCE, "hadPrimarySource"],
      [PROV_SOFTWARE_AGENT, "softwareAgent"],
      [PROV_PERSON, "person"],
      [PROV_ORGANIZATION, "organization"],
      [PROV_PLAN, "plan"],
      [PROV_COLLECTION, "collection"],
      [PROV_EMPTY_COLLECTION, "emptyCollection"],
    ] as ReadonlyArray<readonly [QualifiedName, string]>
  ).map(([qn, name]): [string, string] => [qn.uri, name]),
);

/**
 * Maps each PROV type to its base class QName (or itself), keyed by `qn.uri`.
 * Used by the XML/RDF (de)serializers to collapse extended types. Mirrors
 * `PROV_BASE_CLS` (constants.py:78).
 */
export const PROV_BASE_CLS: ReadonlyMap<string, QualifiedName> = new Map(
  (
    [
      [PROV_ENTITY, PROV_ENTITY],
      [PROV_ACTIVITY, PROV_ACTIVITY],
      [PROV_GENERATION, PROV_GENERATION],
      [PROV_USAGE, PROV_USAGE],
      [PROV_COMMUNICATION, PROV_COMMUNICATION],
      [PROV_START, PROV_START],
      [PROV_END, PROV_END],
      [PROV_INVALIDATION, PROV_INVALIDATION],
      [PROV_DERIVATION, PROV_DERIVATION],
      [PROV_REVISION, PROV_DERIVATION],
      [PROV_QUOTATION, PROV_DERIVATION],
      [PROV_PRIMARY_SOURCE, PROV_DERIVATION],
      [PROV_AGENT, PROV_AGENT],
      [PROV_SOFTWARE_AGENT, PROV_AGENT],
      [PROV_PERSON, PROV_AGENT],
      [PROV_ORGANIZATION, PROV_AGENT],
      [PROV_ATTRIBUTION, PROV_ATTRIBUTION],
      [PROV_ASSOCIATION, PROV_ASSOCIATION],
      [PROV_PLAN, PROV_ENTITY],
      [PROV_DELEGATION, PROV_DELEGATION],
      [PROV_INFLUENCE, PROV_INFLUENCE],
      [PROV_ALTERNATE, PROV_ALTERNATE],
      [PROV_SPECIALIZATION, PROV_SPECIALIZATION],
      [PROV_MENTION, PROV_MENTION],
      [PROV_COLLECTION, PROV_ENTITY],
      [PROV_EMPTY_COLLECTION, PROV_ENTITY],
      [PROV_MEMBERSHIP, PROV_MEMBERSHIP],
      [PROV_BUNDLE, PROV_ENTITY],
    ] as ReadonlyArray<readonly [QualifiedName, QualifiedName]>
  ).map(([qn, base]): [string, QualifiedName] => [qn.uri, base]),
);

// ── Attribute sets & id maps ────────────────────────────────────────────────

// Canonical order for the QName-valued formal attributes (source order in
// constants.py:140). Python builds these as `set`s with nondeterministic
// iteration; we pin an explicit order so the derived id maps are deterministic.
const PROV_ATTRIBUTE_QNAMES_ORDER: readonly QualifiedName[] = [
  PROV_ATTR_ENTITY,
  PROV_ATTR_ACTIVITY,
  PROV_ATTR_TRIGGER,
  PROV_ATTR_INFORMED,
  PROV_ATTR_INFORMANT,
  PROV_ATTR_STARTER,
  PROV_ATTR_ENDER,
  PROV_ATTR_AGENT,
  PROV_ATTR_PLAN,
  PROV_ATTR_DELEGATE,
  PROV_ATTR_RESPONSIBLE,
  PROV_ATTR_GENERATED_ENTITY,
  PROV_ATTR_USED_ENTITY,
  PROV_ATTR_GENERATION,
  PROV_ATTR_USAGE,
  PROV_ATTR_SPECIFIC_ENTITY,
  PROV_ATTR_GENERAL_ENTITY,
  PROV_ATTR_ALTERNATE1,
  PROV_ATTR_ALTERNATE2,
  PROV_ATTR_BUNDLE,
  PROV_ATTR_INFLUENCEE,
  PROV_ATTR_INFLUENCER,
  PROV_ATTR_COLLECTION,
];

// Canonical order for the literal-valued formal attributes (constants.py:165).
const PROV_ATTRIBUTE_LITERALS_ORDER: readonly QualifiedName[] = [
  PROV_ATTR_TIME,
  PROV_ATTR_STARTTIME,
  PROV_ATTR_ENDTIME,
];

/**
 * All formal attributes in canonical order (QName-valued first, then
 * literal-valued). Replaces Python's nondeterministic `PROV_RECORD_ATTRIBUTES`
 * (constants.py:169) with a fixed order — see `00-overview.md` open questions.
 */
export const PROV_ATTRIBUTES_ORDER: readonly QualifiedName[] = [
  ...PROV_ATTRIBUTE_QNAMES_ORDER,
  ...PROV_ATTRIBUTE_LITERALS_ORDER,
];

/** URIs of the QName-valued formal attributes. Mirrors `PROV_ATTRIBUTE_QNAMES` (constants.py:140). */
export const PROV_ATTRIBUTE_QNAMES: ReadonlySet<string> = new Set(
  PROV_ATTRIBUTE_QNAMES_ORDER.map((qn) => qn.uri),
);

/** URIs of the literal-valued formal attributes. Mirrors `PROV_ATTRIBUTE_LITERALS` (constants.py:165). */
export const PROV_ATTRIBUTE_LITERALS: ReadonlySet<string> = new Set(
  PROV_ATTRIBUTE_LITERALS_ORDER.map((qn) => qn.uri),
);

/** URIs of all formal attributes (the union). Mirrors `PROV_ATTRIBUTES` (constants.py:168). */
export const PROV_ATTRIBUTES: ReadonlySet<string> = new Set(
  PROV_ATTRIBUTES_ORDER.map((qn) => qn.uri),
);

/** Attribute URI → its `prov:`-prefixed display string. Mirrors `PROV_ID_ATTRIBUTES_MAP` (constants.py:174). */
export const PROV_ID_ATTRIBUTES_MAP: ReadonlyMap<string, string> = new Map(
  PROV_ATTRIBUTES_ORDER.map((qn): [string, string] => [qn.uri, String(qn)]),
);

/** `prov:`-prefixed display string → attribute QName. Mirrors `PROV_ATTRIBUTES_ID_MAP` (constants.py:177). */
export const PROV_ATTRIBUTES_ID_MAP: ReadonlyMap<string, QualifiedName> =
  new Map(
    PROV_ATTRIBUTES_ORDER.map((qn): [string, QualifiedName] => [String(qn), qn]),
  );
