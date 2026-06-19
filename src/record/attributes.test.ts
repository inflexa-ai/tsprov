import { test, expect, describe } from "bun:test";

import { AttributeStore } from "./attributes";
import { Namespace } from "../identifier";
import { Literal } from "../literal";
import { XSD_STRING } from "../constants";

const EX = new Namespace("ex", "http://example.org/");
const EX_OTHER = new Namespace("other", "http://example.org/");
const ROLE = EX.qn("role");
const TYPE = EX.qn("type");

describe("AttributeStore", () => {
  test("stores and returns values in insertion order", () => {
    const s = new AttributeStore();
    s.add(ROLE, "author");
    s.add(ROLE, "editor");
    expect(s.get(ROLE)).toEqual(["author", "editor"]);
  });

  test("dedups values by value-equality (valueKey)", () => {
    const s = new AttributeStore();
    s.add(TYPE, EX.qn("Doc"));
    s.add(TYPE, EX.qn("Doc")); // same QName
    s.add(TYPE, EX_OTHER.qn("Doc")); // equal QName, different prefix → still dup
    expect(s.get(TYPE)).toHaveLength(1);

    const s2 = new AttributeStore();
    s2.add(ROLE, new Literal("a", XSD_STRING));
    s2.add(ROLE, new Literal("a", XSD_STRING)); // structurally equal literal
    expect(s2.get(ROLE)).toHaveLength(1);
  });

  test("keeps distinct values", () => {
    const s = new AttributeStore();
    s.add(ROLE, "a");
    s.add(ROLE, "b");
    expect(s.get(ROLE)).toHaveLength(2);
  });

  test("has() reflects presence and does NOT create entries on read", () => {
    const s = new AttributeStore();
    expect(s.has(ROLE)).toBe(false);
    expect(s.get(ROLE)).toEqual([]); // read a missing attr
    expect(s.has(ROLE)).toBe(false); // ... no phantom entry created
    s.add(ROLE, "author");
    expect(s.has(ROLE)).toBe(true);
  });

  test("first() returns the first inserted value or undefined", () => {
    const s = new AttributeStore();
    expect(s.first(ROLE)).toBeUndefined();
    s.add(ROLE, "author");
    s.add(ROLE, "editor");
    expect(s.first(ROLE)).toBe("author");
  });

  test("attrNames() lists attributes in insertion order", () => {
    const s = new AttributeStore();
    s.add(ROLE, "author");
    s.add(TYPE, EX.qn("Doc"));
    expect(s.attrNames()).toEqual([ROLE, TYPE]);
  });

  test("pairs() flattens to (name, value) in order; size counts pairs", () => {
    const s = new AttributeStore();
    s.add(ROLE, "author");
    s.add(ROLE, "editor");
    s.add(TYPE, EX.qn("Doc"));
    expect(s.pairs()).toEqual([
      [ROLE, "author"],
      [ROLE, "editor"],
      [TYPE, EX.qn("Doc")],
    ]);
    expect(s.size).toBe(3);
  });

  test("isEmpty() reflects whether anything is stored", () => {
    const s = new AttributeStore();
    expect(s.isEmpty()).toBe(true);
    s.add(ROLE, "author");
    expect(s.isEmpty()).toBe(false);
  });
});
