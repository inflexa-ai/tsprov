import { test, expect, describe, spyOn } from "bun:test";
import { DateTime } from "luxon";

import {
  Literal,
  parseBoolean,
  parseXsdTypes,
  XSD_DATATYPE_PARSERS,
} from "./literal.js";
import { Identifier } from "./identifier.js";
import {
  PROV_INTERNATIONALIZEDSTRING,
  XSD_STRING,
  XSD_INT,
  XSD_DOUBLE,
  XSD_FLOAT,
  XSD_BOOLEAN,
  XSD_DATETIME,
  XSD_ANYURI,
} from "./constants.js";

describe("Literal construction", () => {
  test("coerces the value to a string and keeps the datatype", () => {
    const lit = new Literal(5, XSD_INT);
    expect(lit.value).toBe("5");
    expect(lit.datatype).toBe(XSD_INT);
    expect(lit.langtag).toBeUndefined();
  });

  test("a langtag with no datatype implies prov:InternationalizedString", () => {
    const lit = new Literal("un lieu", undefined, "fr");
    expect(lit.datatype).toBe(PROV_INTERNATIONALIZEDSTRING);
    expect(lit.langtag).toBe("fr");
  });

  test("a langtag overrides a conflicting datatype (with a warning)", () => {
    const spy = spyOn(console, "warn").mockImplementation(() => {});
    const lit = new Literal("hi", XSD_STRING, "en");
    expect(lit.datatype).toBe(PROV_INTERNATIONALIZEDSTRING);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("Literal equality & key", () => {
  test("structural equality over (value, datatype, langtag)", () => {
    expect(new Literal("a", XSD_STRING).equals(new Literal("a", XSD_STRING))).toBe(
      true,
    );
    expect(new Literal("a", XSD_STRING).equals(new Literal("b", XSD_STRING))).toBe(
      false,
    );
    expect(new Literal("1", XSD_INT).equals(new Literal("1", XSD_DOUBLE))).toBe(
      false,
    ); // int vs double survives
    expect(new Literal("a", XSD_STRING).equals("a")).toBe(false); // not a Literal
  });

  test("equal literals share a key; int and double differ", () => {
    expect(new Literal("a", XSD_STRING).key).toBe(new Literal("a", XSD_STRING).key);
    expect(new Literal("1", XSD_INT).key).not.toBe(new Literal("1", XSD_DOUBLE).key);
  });

  test("key distinguishes an absent langtag from an empty one", () => {
    expect(new Literal("a", XSD_STRING).key).not.toBe(
      new Literal("a", XSD_STRING, "").key,
    );
  });

  test("hasNoLangtag reflects the tag", () => {
    expect(new Literal("a", XSD_STRING).hasNoLangtag()).toBe(true);
    expect(new Literal("a", undefined, "fr").hasNoLangtag()).toBe(false);
  });
});

describe("Literal.provnRepresentation", () => {
  test("typed literal: \"value\" %% datatype", () => {
    expect(new Literal("a place", XSD_STRING).provnRepresentation()).toBe(
      '"a place" %% xsd:string',
    );
  });

  test("language-tagged literal: \"value\"@lang", () => {
    expect(new Literal("un lieu", undefined, "fr").provnRepresentation()).toBe(
      '"un lieu"@fr',
    );
  });

  test("multiline values are triple-quoted; embedded quotes escaped", () => {
    expect(new Literal('line1\nline2', XSD_STRING).provnRepresentation()).toBe(
      '"""line1\nline2""" %% xsd:string',
    );
    expect(new Literal('say "hi"', XSD_STRING).provnRepresentation()).toBe(
      '"say \\"hi\\"" %% xsd:string',
    );
  });

  test("toString equals provnRepresentation", () => {
    const lit = new Literal("a", XSD_STRING);
    expect(lit.toString()).toBe(lit.provnRepresentation());
  });
});

describe("parseBoolean (tri-state)", () => {
  test("recognizes true/false forms, null otherwise", () => {
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("1")).toBe(true);
    expect(parseBoolean("TRUE")).toBe(true);
    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean("0")).toBe(false);
    expect(parseBoolean("maybe")).toBeNull();
  });
});

describe("XSD datatype parsers", () => {
  test("the parser table has exactly the 7 Python entries (no xsd:float)", () => {
    expect(XSD_DATATYPE_PARSERS.size).toBe(7);
    expect(XSD_DATATYPE_PARSERS.has(XSD_FLOAT.uri)).toBe(false);
  });

  test("parseXsdTypes decodes each datatype to its native value", () => {
    expect(parseXsdTypes("hello", XSD_STRING)).toBe("hello");
    expect(parseXsdTypes("42", XSD_INT)).toBe(42);
    expect(parseXsdTypes("2.5", XSD_DOUBLE)).toBe(2.5);
    expect(parseXsdTypes("true", XSD_BOOLEAN)).toBe(true);
    expect(parseXsdTypes("2024-01-01T00:00:00+00:00", XSD_DATETIME)).toBeInstanceOf(
      DateTime,
    );
    expect(parseXsdTypes("http://x/1", XSD_ANYURI)).toBeInstanceOf(Identifier);
  });

  test("an unparseable datatype (e.g. xsd:float) yields null", () => {
    expect(parseXsdTypes("1.0", XSD_FLOAT)).toBeNull();
  });
});
