import { test, expect, describe } from "bun:test";

import { ProvRecord, type RecordBundle } from "./record";
import { ProvElement } from "./element";
import { ProvRelation } from "./relation";
import { Namespace, QualifiedName } from "../identifier";
import { Literal } from "../literal";
import { ProvException, ProvExceptionInvalidQualifiedName } from "../error";
import {
  PROV_ENTITY,
  PROV_ACTIVITY,
  PROV_GENERATION,
  PROV_ATTR_ENTITY,
  PROV_ATTR_ACTIVITY,
  PROV_ATTR_TIME,
  XSD_INT,
  XSD_STRING,
  XSD_FLOAT,
} from "../constants";

const EX = new Namespace("ex", "http://example.org/");

// M3 seam: a trivial resolver that only accepts already-resolved QNames.
const bundle: RecordBundle = {
  validQualifiedName: (n) => (n instanceof QualifiedName ? n : null),
  mandatoryValidQname: (n) => {
    if (n instanceof QualifiedName) {
      return n;
    }
    throw new ProvExceptionInvalidQualifiedName(n);
  },
};

// Minimal concrete fixtures. They extend the real `ProvElement`/`ProvRelation`
// bases (rather than overriding `isElement`/`isRelation` by hand) so they inherit
// the genuine element/relation type-guard behavior under test.
class TestEntity extends ProvElement {
  static override readonly prov_type = PROV_ENTITY;
}
class TestActivity extends ProvElement {
  static override readonly prov_type = PROV_ACTIVITY;
}
class TestGeneration extends ProvRelation {
  static override readonly prov_type = PROV_GENERATION;
  static override readonly FORMAL_ATTRIBUTES = [
    PROV_ATTR_ENTITY,
    PROV_ATTR_ACTIVITY,
    PROV_ATTR_TIME,
  ] as const;
}

describe("type & attribute views", () => {
  test("getType reads the subclass prov_type", () => {
    expect(new TestEntity(bundle, EX.qn("e")).getType()).toBe(PROV_ENTITY);
  });

  test("formal vs extra attribute split", () => {
    const g = new TestGeneration(bundle, EX.qn("g"), [
      [PROV_ATTR_ENTITY, EX.qn("e")],
      [PROV_ATTR_ACTIVITY, EX.qn("a")],
      [EX.qn("role"), "author"],
    ]);
    expect(g.formalAttributes).toEqual([
      [PROV_ATTR_ENTITY, EX.qn("e")],
      [PROV_ATTR_ACTIVITY, EX.qn("a")],
      [PROV_ATTR_TIME, undefined],
    ]);
    expect(g.extraAttributes).toEqual([[EX.qn("role"), "author"]]);
    expect(g.attributes).toHaveLength(3);
  });
});

describe("addAttributes single-valued formal rule", () => {
  test("a repeated equal value is ignored", () => {
    const g = new TestGeneration(bundle, EX.qn("g"), [
      [PROV_ATTR_ENTITY, EX.qn("e")],
      [PROV_ATTR_ENTITY, EX.qn("e")], // same → ignored
    ]);
    expect(g.getAttribute(PROV_ATTR_ENTITY)).toEqual([EX.qn("e")]);
  });

  test("a conflicting value throws ProvException", () => {
    expect(
      () =>
        new TestGeneration(bundle, EX.qn("g"), [
          [PROV_ATTR_ENTITY, EX.qn("e1")],
          [PROV_ATTR_ENTITY, EX.qn("e2")],
        ]),
    ).toThrow(ProvException);
  });

  test("a literal-valued formal attr parses datetime strings", () => {
    const g = new TestGeneration(bundle, EX.qn("g"), [
      [PROV_ATTR_TIME, "2024-01-01T00:00:00+00:00"],
    ]);
    expect(g.getAttribute(PROV_ATTR_TIME)).toHaveLength(1);
  });

  test("a non-datetime literal-valued formal attr throws", () => {
    expect(
      () =>
        new TestGeneration(bundle, EX.qn("g"), [[PROV_ATTR_TIME, "not a date"]]),
    ).toThrow(ProvException);
  });
});

describe("asserted types & auto literal conversion", () => {
  test("addAssertedType dedups", () => {
    const e = new TestEntity(bundle, EX.qn("e"));
    e.addAssertedType(EX.qn("T"));
    e.addAssertedType(EX.qn("T"));
    expect(e.getAssertedTypes()).toEqual([EX.qn("T")]);
  });

  test("a parseable typed Literal is converted to its native value", () => {
    const e = new TestEntity(bundle, EX.qn("e"), [
      [EX.qn("rows"), new Literal("5", XSD_INT)],
      [EX.qn("name"), new Literal("Bob", XSD_STRING)],
    ]);
    expect(e.getAttribute(EX.qn("rows"))).toEqual([5]); // number
    expect(e.getAttribute(EX.qn("name"))).toEqual(["Bob"]); // string
  });

  test("a Literal with an unparseable datatype is kept as a Literal", () => {
    const lit = new Literal("1.0", XSD_FLOAT); // xsd:float is not in the parser table
    const e = new TestEntity(bundle, EX.qn("e"), [[EX.qn("ratio"), lit]]);
    expect(e.getAttribute(EX.qn("ratio"))[0]).toBeInstanceOf(Literal);
  });
});

describe("equality & key", () => {
  test("equal records are equal and share a key", () => {
    const a = new TestEntity(bundle, EX.qn("x"), [[EX.qn("role"), "author"]]);
    const b = new TestEntity(bundle, EX.qn("x"), [[EX.qn("role"), "author"]]);
    expect(a.equals(b)).toBe(true);
    expect(a.key).toBe(b.key);
  });

  test("different attributes break equality", () => {
    const a = new TestEntity(bundle, EX.qn("x"), [[EX.qn("role"), "author"]]);
    const b = new TestEntity(bundle, EX.qn("x"), [[EX.qn("role"), "editor"]]);
    expect(a.equals(b)).toBe(false);
    expect(a.key).not.toBe(b.key);
  });

  test("different types break equality (same id)", () => {
    const e = new TestEntity(bundle, EX.qn("x"));
    const a = new TestActivity(bundle, EX.qn("x"));
    expect(e.equals(a)).toBe(false);
  });

  test("attribute order does not affect equality", () => {
    const a = new TestEntity(bundle, EX.qn("x"), [
      [EX.qn("p"), "1"],
      [EX.qn("q"), "2"],
    ]);
    const b = new TestEntity(bundle, EX.qn("x"), [
      [EX.qn("q"), "2"],
      [EX.qn("p"), "1"],
    ]);
    expect(a.equals(b)).toBe(true);
    expect(a.key).toBe(b.key);
  });
});

describe("getProvN", () => {
  test("element with no attributes", () => {
    expect(new TestEntity(bundle, EX.qn("e1")).getProvN()).toBe("entity(ex:e1)");
  });

  test("element with an extra attribute", () => {
    const e = new TestEntity(bundle, EX.qn("e1"), [[EX.qn("role"), "author"]]);
    expect(e.getProvN()).toBe('entity(ex:e1, [ex:role="author"])');
  });

  test("relation renders formal args with - placeholders", () => {
    const g = new TestGeneration(bundle, null, [
      [PROV_ATTR_ENTITY, EX.qn("e1")],
    ]);
    expect(g.getProvN()).toBe("wasGeneratedBy(ex:e1, -, -)");
  });

  test("relation with an identifier uses the 'id; ' prefix and full args", () => {
    const g = new TestGeneration(bundle, EX.qn("g1"), [
      [PROV_ATTR_ENTITY, EX.qn("e1")],
      [PROV_ATTR_ACTIVITY, EX.qn("a1")],
      [PROV_ATTR_TIME, "2024-01-01T00:00:00+00:00"],
    ]);
    expect(g.getProvN()).toBe(
      "wasGeneratedBy(ex:g1; ex:e1, ex:a1, 2024-01-01T00:00:00+00:00)",
    );
  });
});
