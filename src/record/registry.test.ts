import { test, expect, describe } from "bun:test";

import {
  getRecordClass,
  registeredRecordCount,
} from "./registry.js";
// Importing the concrete classes loads their modules and triggers registration.
import { ProvEntity, ProvActivity, ProvAgent } from "./element.js";
import { ProvGeneration, ProvMembership } from "./relation.js";
import { type RecordBundle } from "./record.js";
import { Namespace, QualifiedName } from "../identifier.js";
import { ProvExceptionInvalidQualifiedName } from "../error.js";
import {
  PROV_ENTITY,
  PROV_ACTIVITY,
  PROV_AGENT,
  PROV_GENERATION,
  PROV_MEMBERSHIP,
  PROV_ATTR_ENTITY,
} from "../constants.js";

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

describe("registry", () => {
  test("all 18 concrete classes register themselves", () => {
    expect(registeredRecordCount()).toBe(18);
  });

  test("getRecordClass maps each type to its constructor", () => {
    expect(getRecordClass(PROV_ENTITY)).toBe(ProvEntity);
    expect(getRecordClass(PROV_ACTIVITY)).toBe(ProvActivity);
    expect(getRecordClass(PROV_AGENT)).toBe(ProvAgent);
    expect(getRecordClass(PROV_GENERATION)).toBe(ProvGeneration);
    expect(getRecordClass(PROV_MEMBERSHIP)).toBe(ProvMembership);
  });
});

describe("ProvRecord.copy", () => {
  test("copies an element to an equal, independent instance", () => {
    const e = new ProvEntity(bundle, EX.qn("e"), [[EX.qn("role"), "author"]]);
    const c = e.copy();
    expect(c).not.toBe(e); // distinct object
    expect(c).toBeInstanceOf(ProvEntity); // dispatched through the registry
    expect(c.equals(e)).toBe(true);
    expect(e.equals(c)).toBe(true);
  });

  test("copies a relation", () => {
    const g = new ProvGeneration(bundle, EX.qn("g"), [
      [PROV_ATTR_ENTITY, EX.qn("e")],
    ]);
    const c = g.copy();
    expect(c).toBeInstanceOf(ProvGeneration);
    expect(c.equals(g)).toBe(true);
  });
});
