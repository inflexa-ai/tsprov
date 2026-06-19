// Concrete PROV relations (edges).
//
// Port of `ProvRelation` + the 14 relation classes and `ProvMention`
// (model.py:640-1097). Each declares its `static prov_type` and ordered
// `FORMAL_ATTRIBUTES`, copied verbatim from the Python class definitions.
// `ProvMention` IS-A `ProvSpecialization` (model.py:1079). The fluent builder
// helpers are the bundle's job (M4) and are deferred.

import { ProvRecord } from "./record.js";
import { registerRecordClass } from "./registry.js";
import type { QualifiedName } from "../identifier.js";
import {
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
  PROV_ATTR_ENTITY,
  PROV_ATTR_ACTIVITY,
  PROV_ATTR_TIME,
  PROV_ATTR_INFORMED,
  PROV_ATTR_INFORMANT,
  PROV_ATTR_TRIGGER,
  PROV_ATTR_STARTER,
  PROV_ATTR_ENDER,
  PROV_ATTR_GENERATED_ENTITY,
  PROV_ATTR_USED_ENTITY,
  PROV_ATTR_GENERATION,
  PROV_ATTR_USAGE,
  PROV_ATTR_AGENT,
  PROV_ATTR_PLAN,
  PROV_ATTR_DELEGATE,
  PROV_ATTR_RESPONSIBLE,
  PROV_ATTR_INFLUENCEE,
  PROV_ATTR_INFLUENCER,
  PROV_ATTR_SPECIFIC_ENTITY,
  PROV_ATTR_GENERAL_ENTITY,
  PROV_ATTR_ALTERNATE1,
  PROV_ATTR_ALTERNATE2,
  PROV_ATTR_BUNDLE,
  PROV_ATTR_COLLECTION,
} from "../constants.js";

/** Base class for PROV relations (edges between elements) (`model.py:640`). */
export abstract class ProvRelation extends ProvRecord {
  override isRelation(): this is ProvRelation {
    return true;
  }
}

/** `wasGeneratedBy` — Generation (`model.py:925`). */
export class ProvGeneration extends ProvRelation {
  static override readonly prov_type = PROV_GENERATION;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ENTITY,
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_TIME,
  ] as const;
}

/** `used` — Usage (`model.py:933`). */
export class ProvUsage extends ProvRelation {
  static override readonly prov_type = PROV_USAGE;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_ENTITY,
    PROV_ATTR_TIME,
  ] as const;
}

/** `wasInformedBy` — Communication (`model.py:941`). */
export class ProvCommunication extends ProvRelation {
  static override readonly prov_type = PROV_COMMUNICATION;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_INFORMED,
    PROV_ATTR_INFORMANT,
  ] as const;
}

/** `wasStartedBy` — Start (`model.py:949`). */
export class ProvStart extends ProvRelation {
  static override readonly prov_type = PROV_START;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_TRIGGER,
    PROV_ATTR_STARTER,
    PROV_ATTR_TIME,
  ] as const;
}

/** `wasEndedBy` — End (`model.py:962`). */
export class ProvEnd extends ProvRelation {
  static override readonly prov_type = PROV_END;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_TRIGGER,
    PROV_ATTR_ENDER,
    PROV_ATTR_TIME,
  ] as const;
}

/** `wasInvalidatedBy` — Invalidation (`model.py:975`). */
export class ProvInvalidation extends ProvRelation {
  static override readonly prov_type = PROV_INVALIDATION;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ENTITY,
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_TIME,
  ] as const;
}

/** `wasDerivedFrom` — Derivation (`model.py:984`). */
export class ProvDerivation extends ProvRelation {
  static override readonly prov_type = PROV_DERIVATION;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_GENERATED_ENTITY,
    PROV_ATTR_USED_ENTITY,
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_GENERATION,
    PROV_ATTR_USAGE,
  ] as const;
}

/** `wasAttributedTo` — Attribution (`model.py:1027`). */
export class ProvAttribution extends ProvRelation {
  static override readonly prov_type = PROV_ATTRIBUTION;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ENTITY,
    PROV_ATTR_AGENT,
  ] as const;
}

/** `wasAssociatedWith` — Association (`model.py:1035`). */
export class ProvAssociation extends ProvRelation {
  static override readonly prov_type = PROV_ASSOCIATION;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_AGENT,
    PROV_ATTR_PLAN,
  ] as const;
}

/** `actedOnBehalfOf` — Delegation (`model.py:1043`). */
export class ProvDelegation extends ProvRelation {
  static override readonly prov_type = PROV_DELEGATION;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_DELEGATE,
    PROV_ATTR_RESPONSIBLE,
    PROV_ATTR_ACTIVITY,
  ] as const;
}

/** `wasInfluencedBy` — Influence (`model.py:1051`). */
export class ProvInfluence extends ProvRelation {
  static override readonly prov_type = PROV_INFLUENCE;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_INFLUENCEE,
    PROV_ATTR_INFLUENCER,
  ] as const;
}

/** `specializationOf` — Specialization (`model.py:1060`). */
export class ProvSpecialization extends ProvRelation {
  static override readonly prov_type = PROV_SPECIALIZATION;
  // Annotated (not `as const`) so the ProvMention subclass can widen the tuple.
  static override readonly FORMAL_ATTRIBUTES: readonly QualifiedName[] = [
    PROV_ATTR_SPECIFIC_ENTITY,
    PROV_ATTR_GENERAL_ENTITY,
  ];
}

/** `alternateOf` — Alternate (`model.py:1071`). */
export class ProvAlternate extends ProvRelation {
  static override readonly prov_type = PROV_ALTERNATE;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ALTERNATE1,
    PROV_ATTR_ALTERNATE2,
  ] as const;
}

/** `mentionOf` — Mention, a specific Specialization (`model.py:1079`). */
export class ProvMention extends ProvSpecialization {
  static override readonly prov_type = PROV_MENTION;
  static override readonly FORMAL_ATTRIBUTES: readonly QualifiedName[] = [
    PROV_ATTR_SPECIFIC_ENTITY,
    PROV_ATTR_GENERAL_ENTITY,
    PROV_ATTR_BUNDLE,
  ];
}

/** `hadMember` — Membership (`model.py:1092`). */
export class ProvMembership extends ProvRelation {
  static override readonly prov_type = PROV_MEMBERSHIP;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_COLLECTION,
    PROV_ATTR_ENTITY,
  ] as const;
}

// Self-registration (model.py:1101). Loading this module populates the registry.
registerRecordClass(PROV_GENERATION, ProvGeneration);
registerRecordClass(PROV_USAGE, ProvUsage);
registerRecordClass(PROV_COMMUNICATION, ProvCommunication);
registerRecordClass(PROV_START, ProvStart);
registerRecordClass(PROV_END, ProvEnd);
registerRecordClass(PROV_INVALIDATION, ProvInvalidation);
registerRecordClass(PROV_DERIVATION, ProvDerivation);
registerRecordClass(PROV_ATTRIBUTION, ProvAttribution);
registerRecordClass(PROV_ASSOCIATION, ProvAssociation);
registerRecordClass(PROV_DELEGATION, ProvDelegation);
registerRecordClass(PROV_INFLUENCE, ProvInfluence);
registerRecordClass(PROV_SPECIALIZATION, ProvSpecialization);
registerRecordClass(PROV_ALTERNATE, ProvAlternate);
registerRecordClass(PROV_MENTION, ProvMention);
registerRecordClass(PROV_MEMBERSHIP, ProvMembership);
