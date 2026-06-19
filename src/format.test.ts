import { test, expect, describe } from "bun:test";

import {
  formatFloatG,
  quoteMaybeMultiline,
  encodingProvnValue,
} from "./format";
import { Namespace, Identifier } from "./identifier";
import { Literal } from "./literal";
import { parseXsdDateTime } from "./datetime";
import { XSD_STRING } from "./constants";

const EX = new Namespace("ex", "http://example.org/");

describe("formatFloatG (C %g)", () => {
  // Every expected value is the actual output of Python `'%g' % x` from the
  // reference interpreter.
  test.each([
    [0.0, "0"],
    [1.0, "1"],
    [2.0, "2"],
    [1.5, "1.5"],
    [0.1, "0.1"],
    [0.5, "0.5"],
    [-2.5, "-2.5"],
    [100000.0, "100000"],
    [1000000.0, "1e+06"],
    [10000000.0, "1e+07"],
    [0.0001, "0.0001"],
    [1e-5, "1e-05"],
    [1e-6, "1e-06"],
    [123456.0, "123456"],
    [1234567.0, "1.23457e+06"],
    [3.14159265, "3.14159"],
    [123.456789, "123.457"],
    [1e20, "1e+20"],
    [1e-20, "1e-20"],
    [0.6666666666666666, "0.666667"],
    [0.000123456, "0.000123456"],
    [1234567890.0, "1.23457e+09"],
  ])("%g of %p is %p", (input, expected) => {
    expect(formatFloatG(input)).toBe(expected);
  });

  test("special values match Python", () => {
    expect(formatFloatG(Infinity)).toBe("inf");
    expect(formatFloatG(-Infinity)).toBe("-inf");
    expect(formatFloatG(NaN)).toBe("nan");
    expect(formatFloatG(-0)).toBe("-0");
  });
});

describe("quoteMaybeMultiline", () => {
  test("single-line values get double quotes", () => {
    expect(quoteMaybeMultiline("a place")).toBe('"a place"');
  });

  test("multi-line values get triple quotes", () => {
    expect(quoteMaybeMultiline("line1\nline2")).toBe('"""line1\nline2"""');
  });

  test("embedded double quotes are escaped", () => {
    expect(quoteMaybeMultiline('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe("encodingProvnValue", () => {
  test("strings are quoted with no datatype suffix", () => {
    expect(encodingProvnValue("hello")).toBe('"hello"');
  });

  test("numbers encode as xsd:float via %g", () => {
    expect(encodingProvnValue(2.0)).toBe('"2" %% xsd:float');
    expect(encodingProvnValue(1234567.0)).toBe('"1.23457e+06" %% xsd:float');
  });

  test("booleans encode as 1/0 xsd:boolean", () => {
    expect(encodingProvnValue(true)).toBe('"1" %% xsd:boolean');
    expect(encodingProvnValue(false)).toBe('"0" %% xsd:boolean');
  });

  test("datetimes encode with an xsd:dateTime suffix", () => {
    expect(
      encodingProvnValue(parseXsdDateTime("2024-01-01T00:00:00+00:00")!),
    ).toBe('"2024-01-01T00:00:00+00:00" %% xsd:dateTime');
  });

  test("a QName renders as its prefixed name (unquoted)", () => {
    expect(encodingProvnValue(EX.qn("Entity"))).toBe("ex:Entity");
  });

  test("a Literal renders as its PROV-N form", () => {
    expect(encodingProvnValue(new Literal("a", XSD_STRING))).toBe(
      '"a" %% xsd:string',
    );
  });

  test("an Identifier renders as its bare URI", () => {
    expect(encodingProvnValue(new Identifier("http://x/1"))).toBe("http://x/1");
  });
});
