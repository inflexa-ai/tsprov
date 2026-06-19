import { test, expect, describe } from "bun:test";

import { valueKey } from "./value";
import { Identifier, Namespace } from "./identifier";
import { Literal } from "./literal";
import { parseXsdDateTime } from "./datetime";
import { XSD_STRING, XSD_INT } from "./constants";

const EX = new Namespace("ex", "http://example.org/");
const EX_OTHER = new Namespace("other", "http://example.org/");

describe("valueKey", () => {
  test("tags each value kind distinctly", () => {
    expect(valueKey("hello")).toBe("S\u0000hello");
    expect(valueKey(42)).toBe("N\u000042");
    expect(valueKey(true)).toBe("B\u00001");
    expect(valueKey(false)).toBe("B\u00000");
    expect(valueKey(EX.qn("foo"))).toBe("Q\u0000http://example.org/foo");
    expect(valueKey(new Identifier("http://x/1"))).toBe("I\u0000http://x/1");
    expect(valueKey(new Literal("a", XSD_STRING))).toBe(
      new Literal("a", XSD_STRING).key,
    );
    expect(valueKey(parseXsdDateTime("2024-01-01T00:00:00+00:00")!)).toBe(
      "D\u00002024-01-01T00:00:00+00:00",
    );
  });

  test("a string and a same-URI QName never collide (different Python types)", () => {
    expect(valueKey("http://example.org/foo")).not.toBe(valueKey(EX.qn("foo")));
  });

  test("a QName and an Identifier of the same URI never collide", () => {
    expect(valueKey(EX.qn("foo"))).not.toBe(
      valueKey(new Identifier("http://example.org/foo")),
    );
  });

  test("equal values produce equal keys (the dedup contract)", () => {
    // QNames are prefix-independent, so different-prefix same-URI dedup.
    expect(valueKey(EX.qn("foo"))).toBe(valueKey(EX_OTHER.qn("foo")));
    // Structurally-equal literals dedup.
    expect(valueKey(new Literal("a", XSD_STRING))).toBe(
      valueKey(new Literal("a", XSD_STRING)),
    );
  });

  test("int and double literals stay distinct via the datatype", () => {
    expect(valueKey(new Literal("1", XSD_INT))).not.toBe(
      valueKey(new Literal("1", XSD_STRING)),
    );
  });

  test("QualifiedName is keyed as Q (checked before its Identifier base)", () => {
    expect(valueKey(EX.qn("foo")).startsWith("Q\u0000")).toBe(true);
  });
});
