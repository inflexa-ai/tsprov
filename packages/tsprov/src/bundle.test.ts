import { test, expect, describe } from "bun:test";

import { ProvBundle } from "./bundle.js";
import { ProvEntity, ProvActivity, ProvAgent, ProvElement } from "./record/element.js";
import { ProvGeneration, ProvRelation } from "./record/relation.js";
import {
  PROV_ENTITY,
  PROV_GENERATION,
  PROV_DERIVATION,
  PROV_REVISION,
  PROV_COLLECTION,
} from "./constants.js";

function exBundle(): ProvBundle {
  const b = new ProvBundle();
  b.addNamespace("ex", "http://example.org/");
  return b;
}

describe("authoring", () => {
  test("builds elements and a relation with correct PROV-N", () => {
    const b = exBundle();
    const e = b.entity("ex:report");
    const a = b.activity(
      "ex:write",
      "2024-01-01T09:00:00+00:00",
      "2024-01-01T09:05:00+00:00",
    );
    const g = b.wasGeneratedBy(e, a, "2024-01-01T09:05:00+00:00");

    expect(e).toBeInstanceOf(ProvEntity);
    expect(a).toBeInstanceOf(ProvActivity);
    expect(g).toBeInstanceOf(ProvGeneration);
    expect(e.getProvN()).toBe("entity(ex:report)");
    expect(a.getProvN()).toBe(
      "activity(ex:write, 2024-01-01T09:00:00+00:00, 2024-01-01T09:05:00+00:00)",
    );
    expect(g.getProvN()).toBe(
      "wasGeneratedBy(ex:report, ex:write, 2024-01-01T09:05:00+00:00)",
    );
    expect(b.records).toHaveLength(3);
  });

  test("an activity with no times renders - placeholders", () => {
    expect(exBundle().activity("ex:a").getProvN()).toBe("activity(ex:a, -, -)");
  });

  test("record refs and string ids are both accepted as relation args", () => {
    const b = exBundle();
    const e = b.entity("ex:report");
    const byRef = b.wasGeneratedBy(e, "ex:write"); // entity object + string id
    expect(byRef.getProvN()).toBe("wasGeneratedBy(ex:report, ex:write, -)");
  });

  test("the object attribute form resolves string keys via the bundle", () => {
    const b = exBundle();
    const e = b.entity("ex:report", { "ex:role": "author" });
    expect(e.getProvN()).toBe('entity(ex:report, [ex:role="author"])');
  });
});

describe("lookup & namespaces", () => {
  test("getRecord resolves by identifier", () => {
    const b = exBundle();
    const e = b.entity("ex:report");
    expect(b.getRecord("ex:report")).toEqual([e]);
    expect(b.getRecord("ex:missing")).toEqual([]);
  });

  test("mandatoryValidQname throws on an unresolvable name", () => {
    expect(() => exBundle().mandatoryValidQname("nope:foo")).toThrow();
  });

  test("isBundle / isDocument", () => {
    const b = new ProvBundle();
    expect(b.isBundle()).toBe(true);
    expect(b.isDocument()).toBe(false);
  });
});

describe("camelCase-primary aliases", () => {
  test("descriptive aliases delegate to the primary builders", () => {
    const b = exBundle();
    b.entity("ex:e");
    b.activity("ex:a");
    const g = b.generation("ex:e", "ex:a"); // alias of wasGeneratedBy
    expect(g.getType()).toBe(PROV_GENERATION);
    expect(g).toBeInstanceOf(ProvGeneration);
  });
});

describe("subtype builders", () => {
  test("wasRevisionOf is a derivation asserting prov:Revision", () => {
    const b = exBundle();
    const r = b.wasRevisionOf("ex:e2", "ex:e1");
    expect(r.getType()).toBe(PROV_DERIVATION);
    expect(r.getAssertedTypes()).toContain(PROV_REVISION);
  });

  test("collection is an entity asserting prov:Collection", () => {
    const b = exBundle();
    const c = b.collection("ex:coll");
    expect(c.getType()).toBe(PROV_ENTITY);
    expect(c.getAssertedTypes()).toContain(PROV_COLLECTION);
  });
});

describe("bundle equality", () => {
  function build(): ProvBundle {
    const b = new ProvBundle();
    b.addNamespace("ex", "http://example.org/");
    b.entity("ex:report");
    b.activity("ex:write");
    b.wasGeneratedBy("ex:report", "ex:write");
    return b;
  }

  test("identically-authored bundles are equal", () => {
    expect(build().equals(build())).toBe(true);
  });

  test("an extra record breaks equality", () => {
    const b = build();
    b.entity("ex:extra");
    expect(build().equals(b)).toBe(false);
  });

  test("equality ignores authoring order", () => {
    const b1 = new ProvBundle();
    b1.addNamespace("ex", "http://example.org/");
    b1.entity("ex:a");
    b1.entity("ex:b");
    const b2 = new ProvBundle();
    b2.addNamespace("ex", "http://example.org/");
    b2.entity("ex:b");
    b2.entity("ex:a");
    expect(b1.equals(b2)).toBe(true);
  });
});

describe("getRecords class filtering (model.py:1527)", () => {
  function populated(): ProvBundle {
    const b = exBundle();
    b.entity("ex:e");
    b.activity("ex:a");
    b.agent("ex:ag");
    b.wasGeneratedBy("ex:e", "ex:a");
    return b;
  }

  test("no filter returns every record", () => {
    expect(populated().getRecords()).toHaveLength(4);
  });

  test("a single class filters and narrows the result type", () => {
    const entities = populated().getRecords(ProvEntity);
    // Compile-time: `entities` is `ProvEntity[]` (no cast) — `.value` is entity-only.
    expect(entities.every((e: ProvEntity) => e instanceof ProvEntity)).toBe(true);
    expect(entities).toHaveLength(1);
  });

  test("an abstract base class matches all its subclasses", () => {
    const b = populated();
    expect(b.getRecords(ProvElement)).toHaveLength(3); // entity + activity + agent
    expect(b.getRecords(ProvRelation)).toHaveLength(1); // the generation
  });

  test("an array of classes is a union filter", () => {
    const some = populated().getRecords([ProvEntity, ProvAgent]);
    expect(some).toHaveLength(2);
    expect(some.some((r) => r instanceof ProvEntity)).toBe(true);
    expect(some.some((r) => r instanceof ProvAgent)).toBe(true);
  });

  test("a class with no instances yields an empty array", () => {
    expect(populated().getRecords(ProvGeneration)).toHaveLength(1);
    expect(new ProvBundle().getRecords(ProvActivity)).toEqual([]);
  });
});
