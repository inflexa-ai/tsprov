import { test, expect, describe } from "bun:test";

import { ProvBundle } from "../bundle";
import { ProvDocument } from "../document";
import type { ProvRecord } from "./record";
import { ProvEntity, ProvActivity, ProvAgent, ProvElement } from "./element";
import {
  ProvGeneration,
  ProvUsage,
  ProvAssociation,
  ProvDelegation,
  ProvRelation,
} from "./relation";

function exBundle(): ProvBundle {
  const b = new ProvBundle();
  b.addNamespace("ex", "http://example.org/");
  return b;
}

describe("fluent record methods", () => {
  test("return the record itself for chaining", () => {
    const b = exBundle();
    const e = b.entity("ex:report");
    const a = b.activity("ex:write");
    expect(e.wasGeneratedBy(a)).toBe(e);
    expect(a.used(b.entity("ex:input"))).toBe(a);
  });

  test("produce records equal to the bundle-builder form", () => {
    const fluent = (() => {
      const b = exBundle();
      const e = b.entity("ex:report");
      const a = b.activity("ex:write");
      const ag = b.agent("ex:alice");
      e.wasGeneratedBy(a, "2024-01-01T09:00:00+00:00").wasAttributedTo(ag);
      a.used(b.entity("ex:input")).wasAssociatedWith(ag);
      return b;
    })();

    const builder = (() => {
      const b = exBundle();
      const e = b.entity("ex:report");
      const a = b.activity("ex:write");
      const ag = b.agent("ex:alice");
      b.wasGeneratedBy(e, a, "2024-01-01T09:00:00+00:00");
      b.wasAttributedTo(e, ag);
      const input = b.entity("ex:input");
      b.used(a, input);
      b.wasAssociatedWith(a, ag);
      return b;
    })();

    expect(fluent.equals(builder)).toBe(true);
  });

  test("each fluent method creates the expected relation type", () => {
    const b = exBundle();
    const e = b.entity("ex:e");
    const a = b.activity("ex:a");
    const ag = b.agent("ex:ag");
    e.wasGeneratedBy(a);
    a.used(e);
    a.wasAssociatedWith(ag);
    ag.actedOnBehalfOf(b.agent("ex:boss"));

    const types = b.records.map((r) => r.constructor);
    expect(types).toContain(ProvGeneration);
    expect(types).toContain(ProvUsage);
    expect(types).toContain(ProvAssociation);
    expect(types).toContain(ProvDelegation);
  });

  test("the records remain their concrete element classes", () => {
    const b = exBundle();
    expect(b.entity("ex:e")).toBeInstanceOf(ProvEntity);
    expect(b.activity("ex:a")).toBeInstanceOf(ProvActivity);
    expect(b.agent("ex:ag")).toBeInstanceOf(ProvAgent);
  });
});

describe("is* type-guard narrowing", () => {
  // Each branch body assigns the guarded value to the narrowed type. These
  // compile *only* if the `is*` methods are type predicates — a plain `boolean`
  // return would leave the wider type and fail `tsc`. So the build is the assertion.
  test("isElement / isRelation narrow a ProvRecord", () => {
    const b = exBundle();
    const element: ProvRecord = b.entity("ex:e");
    const relation: ProvRecord = b.wasGeneratedBy(b.entity("ex:e2"), b.activity("ex:a"));

    if (element.isElement()) {
      const narrowed: ProvElement = element;
      expect(narrowed).toBe(element);
    } else {
      throw new Error("entity should narrow to ProvElement");
    }

    if (relation.isRelation()) {
      const narrowed: ProvRelation = relation;
      expect(narrowed).toBe(relation);
    } else {
      throw new Error("generation should narrow to ProvRelation");
    }
  });

  test("isDocument narrows a ProvBundle to ProvDocument", () => {
    const container: ProvBundle = new ProvDocument();
    if (container.isDocument()) {
      const doc: ProvDocument = container;
      expect(doc.bundles).toEqual([]); // ProvDocument-only member, reachable via the guard
    } else {
      throw new Error("ProvDocument should narrow via isDocument()");
    }
  });
});

describe("ref types reject mismatched record kinds", () => {
  // The `@ts-expect-error` lines below are the assertion: each must be a genuine
  // compile error, or `tsc` flags the directive as unused and the build fails. They
  // run at runtime too (harmless records in a throwaway bundle) — proof the distinct
  // ref types catch a wrong-kind argument the old shared `ProvRecord` alias allowed.
  test("a wrong-kind record is a compile error; a string id still works", () => {
    const b = exBundle();
    const e = b.entity("ex:e");
    const a = b.activity("ex:a");
    const ag = b.agent("ex:ag");

    // Correct kinds compile and chain:
    expect(e.wasGeneratedBy(a)).toBe(e);
    expect(a.wasAssociatedWith(ag)).toBe(a);
    // String/QName ids remain the deliberate escape hatch:
    expect(e.wasGeneratedBy("ex:other")).toBe(e);

    // @ts-expect-error — an agent is not an ActivityRef
    e.wasGeneratedBy(ag);
    // @ts-expect-error — an entity is not an AgentRef
    a.wasAssociatedWith(e);
  });
});
