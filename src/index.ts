// Public API for the `tsprov` library — the W3C PROV data model in TypeScript.
//
// This is the package's single public barrel (the entry point `package.json`
// resolves to). It is the one intentional exception to the "no barrels / no
// re-exports" rule: internal modules import each other directly. Keep this file
// limited to the *public, dependency-free core* surface.

export { Identifier, QualifiedName, Namespace } from "./identifier.js";
export type { QNameString } from "./identifier.js";

export { ns, internNamespace, internQName } from "./intern.js";

export { Literal } from "./literal.js";

export { ensureDateTime, parseXsdDateTime, toXsdDateTime } from "./datetime.js";
export type { DateLike } from "./datetime.js";

export {
  ProvError,
  ProvException,
  ProvExceptionInvalidQualifiedName,
  ProvElementIdentifierRequired,
  setWarningHandler,
} from "./error.js";
export type { WarningHandler } from "./error.js";

export { valueKey } from "./value.js";
export type { AttrValue } from "./value.js";

// The record layer: the abstract base, the 3 elements, the 15 relations, and
// the type registry.
export { ProvRecord } from "./record/record.js";
export type {
  RecordBundle,
  ProvAttributes,
  AttrKey,
  QualifiedNameCandidate,
} from "./record/record.js";
export {
  ProvElement,
  ProvEntity,
  ProvActivity,
  ProvAgent,
} from "./record/element.js";
export {
  ProvRelation,
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
} from "./record/relation.js";
export {
  registerRecordClass,
  getRecordClass,
} from "./record/registry.js";
export type { RecordCtor, RecordTypeQName } from "./record/registry.js";

export { NamespaceManager } from "./namespace-manager.js";
export type { NamespaceCollection } from "./namespace-manager.js";

export { ProvBundle } from "./bundle.js";
export type {
  EntityRef,
  ActivityRef,
  AgentRef,
  RecordClass,
  RecordInstance,
} from "./bundle.js";
export type { AttributeValue } from "./record/record.js";

export { ProvDocument } from "./document.js";

// Serializer registry + the built-in PROV-N and PROV-JSON serializers.
export {
  getSerializer,
  registerSerializer,
  registeredFormats,
  DoNotExist,
  UnsupportedOperationError,
} from "./serializers/serializer.js";
export type {
  Serializer,
  SerializeOptions,
  DeserializeOptions,
  ProvFormat,
  BuiltinProvFormat,
} from "./serializers/serializer.js";
// Value-export the serializers so their modules (and their `registerSerializer`
// calls) are included in the bundle despite `sideEffects: false`.
export { ProvNSerializer } from "./serializers/provn.js";
export { ProvJsonSerializer, ProvJSONException } from "./serializers/json.js";

export { read } from "./read.js";

// Public PROV/XSD constants: namespaces, type & attribute QNames, XSD datatypes.
// The internal wiring maps (PROV_N_MAP, PROV_BASE_CLS, the id maps, …) are
// intentionally NOT exported — they are an implementation detail.
export {
  // Namespaces
  PROV,
  XSD,
  XSI,
  // Record type QNames
  PROV_ENTITY,
  PROV_ACTIVITY,
  PROV_GENERATION,
  PROV_USAGE,
  PROV_COMMUNICATION,
  PROV_START,
  PROV_END,
  PROV_INVALIDATION,
  PROV_DERIVATION,
  PROV_AGENT,
  PROV_ATTRIBUTION,
  PROV_ASSOCIATION,
  PROV_DELEGATION,
  PROV_INFLUENCE,
  PROV_BUNDLE,
  PROV_ALTERNATE,
  PROV_SPECIALIZATION,
  PROV_MENTION,
  PROV_MEMBERSHIP,
  // Subtype QNames
  PROV_REVISION,
  PROV_QUOTATION,
  PROV_PRIMARY_SOURCE,
  PROV_SOFTWARE_AGENT,
  PROV_PERSON,
  PROV_ORGANIZATION,
  PROV_PLAN,
  PROV_COLLECTION,
  PROV_EMPTY_COLLECTION,
  // Formal attribute QNames
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
  PROV_ATTR_TIME,
  PROV_ATTR_STARTTIME,
  PROV_ATTR_ENDTIME,
  // Convenience QNames
  PROV_TYPE,
  PROV_LABEL,
  PROV_VALUE,
  PROV_LOCATION,
  PROV_ROLE,
  PROV_QUALIFIEDNAME,
  PROV_INTERNATIONALIZEDSTRING,
  // XSD datatypes
  XSD_ANYURI,
  XSD_QNAME,
  XSD_DATETIME,
  XSD_TIME,
  XSD_DATE,
  XSD_STRING,
  XSD_BOOLEAN,
  XSD_INTEGER,
  XSD_LONG,
  XSD_INT,
  XSD_SHORT,
  XSD_BYTE,
  XSD_NONNEGATIVEINTEGER,
  XSD_UNSIGNEDLONG,
  XSD_UNSIGNEDINT,
  XSD_UNSIGNEDSHORT,
  XSD_UNSIGNEDBYTE,
  XSD_POSITIVEINTEGER,
  XSD_NONPOSITIVEINTEGER,
  XSD_NEGATIVEINTEGER,
  XSD_FLOAT,
  XSD_DOUBLE,
  XSD_DECIMAL,
} from "./constants.js";
