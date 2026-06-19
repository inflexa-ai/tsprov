import { test, expect, describe } from "bun:test";

import { ProvBundle } from "../bundle";
import { ProvEntity, ProvActivity, ProvAgent } from "./element";
import {
  ProvGeneration,
  ProvUsage,
  ProvAssociation,
  ProvDelegation,
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
