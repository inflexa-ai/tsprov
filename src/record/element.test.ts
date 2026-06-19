import { test, expect, describe } from "bun:test";

import { ProvEntity, ProvActivity, ProvAgent } from "./element";
import { type RecordBundle } from "./record";
import { Namespace, QualifiedName } from "../identifier";
import { ProvElementIdentifierRequired, ProvExceptionInvalidQualifiedName } from "../error";
import {
  PROV_ENTITY,
  PROV_ACTIVITY,
  PROV_AGENT,
  PROV_ATTR_STARTTIME,
  PROV_ATTR_ENDTIME,
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

describe("ProvElement", () => {
  test("requires an identifier", () => {
    expect(() => new ProvEntity(bundle, null)).toThrow(
      ProvElementIdentifierRequired,
    );
  });

  test("elements report isElement / isRelation", () => {
    const e = new ProvEntity(bundle, EX.qn("e"));
    expect(e.isElement()).toBe(true);
    expect(e.isRelation()).toBe(false);
  });
});

describe("element types", () => {
  test("ProvEntity", () => {
    const e = new ProvEntity(bundle, EX.qn("e"));
    expect(e.getType()).toBe(PROV_ENTITY);
    expect(e.getProvN()).toBe("entity(ex:e)");
  });

  test("ProvAgent", () => {
    const a = new ProvAgent(bundle, EX.qn("ag"));
    expect(a.getType()).toBe(PROV_AGENT);
    expect(a.getProvN()).toBe("agent(ex:ag)");
  });

  test("ProvActivity has the start/end time formal attributes", () => {
    expect([...ProvActivity.FORMAL_ATTRIBUTES]).toEqual([
      PROV_ATTR_STARTTIME,
      PROV_ATTR_ENDTIME,
    ]);
    expect(new ProvActivity(bundle, EX.qn("a")).getType()).toBe(PROV_ACTIVITY);
  });
});

describe("ProvActivity.setTime", () => {
  test("stores times raw (a string stays verbatim) and replaces", () => {
    const a = new ProvActivity(bundle, EX.qn("a"));
    a.setTime("2024-01-01T09:00:00");
    expect(a.getStartTime()).toBe("2024-01-01T09:00:00"); // raw, un-parsed
    a.setTime("2024-01-01T10:00:00"); // replaces
    expect(a.getStartTime()).toBe("2024-01-01T10:00:00");
  });

  test("sets start and end independently", () => {
    const a = new ProvActivity(bundle, EX.qn("a"));
    a.setTime("2024-01-01T09:00:00", "2024-01-01T17:00:00");
    expect(a.getStartTime()).toBe("2024-01-01T09:00:00");
    expect(a.getEndTime()).toBe("2024-01-01T17:00:00");
  });

  test("renders raw times in PROV-N with a - for the missing one", () => {
    const a = new ProvActivity(bundle, EX.qn("a"));
    a.setTime("2024-01-01T09:00:00");
    expect(a.getProvN()).toBe("activity(ex:a, 2024-01-01T09:00:00, -)");
  });
});
