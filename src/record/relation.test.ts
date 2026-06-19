import { test, expect, describe } from "bun:test";

import {
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
} from "./relation";
import { type RecordBundle } from "./record";
import { Namespace, QualifiedName } from "../identifier";
import { ProvExceptionInvalidQualifiedName } from "../error";
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
} from "../constants";

const EX = new Namespace("ex", "http://example.org/");
const bundle: RecordBundle = {
  validQualifiedName: (n) => (n instanceof QualifiedName ? n : null),
  mandatoryValidQname: (n) => {
    if (n instanceof QualifiedName) {
      return n;
    }
    throw new ProvExceptionInvalidQualifiedName(n);
  },
};

// [class, expected prov_type, expected FORMAL_ATTRIBUTES] — copied from model.py.
const RELATIONS = [
  [ProvGeneration, PROV_GENERATION, [PROV_ATTR_ENTITY, PROV_ATTR_ACTIVITY, PROV_ATTR_TIME]],
  [ProvUsage, PROV_USAGE, [PROV_ATTR_ACTIVITY, PROV_ATTR_ENTITY, PROV_ATTR_TIME]],
  [ProvCommunication, PROV_COMMUNICATION, [PROV_ATTR_INFORMED, PROV_ATTR_INFORMANT]],
  [ProvStart, PROV_START, [PROV_ATTR_ACTIVITY, PROV_ATTR_TRIGGER, PROV_ATTR_STARTER, PROV_ATTR_TIME]],
  [ProvEnd, PROV_END, [PROV_ATTR_ACTIVITY, PROV_ATTR_TRIGGER, PROV_ATTR_ENDER, PROV_ATTR_TIME]],
  [ProvInvalidation, PROV_INVALIDATION, [PROV_ATTR_ENTITY, PROV_ATTR_ACTIVITY, PROV_ATTR_TIME]],
  [ProvDerivation, PROV_DERIVATION, [PROV_ATTR_GENERATED_ENTITY, PROV_ATTR_USED_ENTITY, PROV_ATTR_ACTIVITY, PROV_ATTR_GENERATION, PROV_ATTR_USAGE]],
  [ProvAttribution, PROV_ATTRIBUTION, [PROV_ATTR_ENTITY, PROV_ATTR_AGENT]],
  [ProvAssociation, PROV_ASSOCIATION, [PROV_ATTR_ACTIVITY, PROV_ATTR_AGENT, PROV_ATTR_PLAN]],
  [ProvDelegation, PROV_DELEGATION, [PROV_ATTR_DELEGATE, PROV_ATTR_RESPONSIBLE, PROV_ATTR_ACTIVITY]],
  [ProvInfluence, PROV_INFLUENCE, [PROV_ATTR_INFLUENCEE, PROV_ATTR_INFLUENCER]],
  [ProvSpecialization, PROV_SPECIALIZATION, [PROV_ATTR_SPECIFIC_ENTITY, PROV_ATTR_GENERAL_ENTITY]],
  [ProvAlternate, PROV_ALTERNATE, [PROV_ATTR_ALTERNATE1, PROV_ATTR_ALTERNATE2]],
  [ProvMention, PROV_MENTION, [PROV_ATTR_SPECIFIC_ENTITY, PROV_ATTR_GENERAL_ENTITY, PROV_ATTR_BUNDLE]],
  [ProvMembership, PROV_MEMBERSHIP, [PROV_ATTR_COLLECTION, PROV_ATTR_ENTITY]],
] as const;

describe("relation classes", () => {
  test("there are 15 relation classes", () => {
    expect(RELATIONS).toHaveLength(15);
  });

  test.each(RELATIONS)(
    "%p has the right prov_type and formal attributes",
    (Ctor, expectedType, expectedFormal) => {
      expect(Ctor.prov_type).toBe(expectedType);
      expect([...Ctor.FORMAL_ATTRIBUTES]).toEqual([...expectedFormal]);
      const instance = new Ctor(bundle, null);
      expect(instance.getType()).toBe(expectedType);
      expect(instance.isRelation()).toBe(true);
      expect(instance.isElement()).toBe(false);
      expect(instance).toBeInstanceOf(ProvRelation);
    },
  );

  test("ProvMention IS-A ProvSpecialization (model.py:1079)", () => {
    expect(new ProvMention(bundle, null)).toBeInstanceOf(ProvSpecialization);
  });

  test("getProvN renders the relation with formal args and - placeholders", () => {
    const g = new ProvGeneration(bundle, null, [
      [PROV_ATTR_ENTITY, EX.qn("e1")],
      [PROV_ATTR_ACTIVITY, EX.qn("a1")],
    ]);
    expect(g.getProvN()).toBe("wasGeneratedBy(ex:e1, ex:a1, -)");
  });
});
