import { test, expect, describe } from "bun:test";

import { ProvBundle } from "./bundle.js";
import { ProvDocument } from "./document.js";

const EX = "http://example.org/";

describe("ProvBundle.unified", () => {
  test("merges records sharing an identifier", () => {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.entity("ex:e", { "ex:a": "1" });
    b.entity("ex:e", { "ex:b": "2" });
    expect(b.getRecord("ex:e")).toHaveLength(2);

    const u = b.unified();
    const merged = u.getRecord("ex:e");
    expect(merged).toHaveLength(1);
    const provn = merged[0]!.getProvN();
    expect(provn).toContain('ex:a="1"');
    expect(provn).toContain('ex:b="2"');
  });

  test("leaves distinct records untouched", () => {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.entity("ex:a");
    b.entity("ex:b");
    expect(b.unified().records).toHaveLength(2);
  });
});

describe("ProvBundle.update", () => {
  test("appends another bundle's records", () => {
    const b1 = new ProvBundle();
    b1.addNamespace("ex", EX);
    b1.entity("ex:a");
    const b2 = new ProvBundle();
    b2.addNamespace("ex", EX);
    b2.entity("ex:b");

    b1.update(b2);
    expect(b1.records).toHaveLength(2);
    expect(b1.getRecord("ex:b")).toHaveLength(1);
  });
});

describe("ProvDocument.update", () => {
  test("merges document records and same-id bundles", () => {
    function doc(top: string, nested: string): ProvDocument {
      const d = new ProvDocument();
      d.addNamespace("ex", EX);
      d.entity(top);
      d.bundle("ex:bnd").entity(nested);
      return d;
    }
    const d1 = doc("ex:x", "ex:in1");
    d1.update(doc("ex:y", "ex:in2"));

    expect(d1.records).toHaveLength(2); // ex:x + ex:y
    expect(d1.bundles).toHaveLength(1); // ex:bnd merged, not duplicated
    expect(d1.bundles[0]!.records).toHaveLength(2); // ex:in1 + ex:in2
  });
});

describe("ProvDocument.addBundle", () => {
  test("adds an external bundle under a given identifier", () => {
    const ext = new ProvBundle(null, null, { ex: EX });
    ext.entity("ex:nested");

    const d = new ProvDocument();
    d.addNamespace("ex", EX);
    d.addBundle(ext, d.mandatoryValidQname("ex:b1"));

    expect(d.hasBundles()).toBe(true);
    expect(d.bundles[0]!.identifier!.uri).toBe("http://example.org/b1");
    expect(d.bundles[0]!.getRecord("ex:nested")).toHaveLength(1);
  });

  test("rejects a duplicate bundle identifier", () => {
    const d = new ProvDocument();
    d.addNamespace("ex", EX);
    d.bundle("ex:b1");
    const ext = new ProvBundle(null, null, { ex: EX });
    expect(() => d.addBundle(ext, d.mandatoryValidQname("ex:b1"))).toThrow();
  });
});

describe("ProvDocument.unified", () => {
  test("returns a document with same-id records unified", () => {
    const d = new ProvDocument();
    d.addNamespace("ex", EX);
    d.entity("ex:e", { "ex:a": "1" });
    d.entity("ex:e", { "ex:b": "2" });

    const u = d.unified();
    expect(u).toBeInstanceOf(ProvDocument);
    expect(u.getRecord("ex:e")).toHaveLength(1);
  });
});

// Two ISO-8601 instants an hour apart. Rendered PROV-N carries the wall-clock
// time (`…T10:00:00+00:00`), so the surviving value is asserted via a substring.
const T10 = "2026-01-01T10:00:00.000Z";
const T11 = "2026-01-01T11:00:00.000Z";

describe("ProvBundle.unified — formalAttributeConflict policy", () => {
  function conflictingStartTimes(): ProvBundle {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.activity("ex:a", T10); // startTime is the 2nd arg
    b.activity("ex:a", T11); // same id, later start observed
    return b;
  }

  test("default (no options) throws on a conflicting single-valued formal attribute", () => {
    expect(() => conflictingStartTimes().unified()).toThrow(
      "Cannot have more than one value for attribute prov:startTime",
    );
  });

  test('explicit "throw" also throws', () => {
    expect(() =>
      conflictingStartTimes().unified({ formalAttributeConflict: "throw" }),
    ).toThrow("Cannot have more than one value for attribute prov:startTime");
  });

  test('"first" keeps the earliest-recorded value', () => {
    const u = conflictingStartTimes().unified({
      formalAttributeConflict: "first",
    });
    const merged = u.getRecord("ex:a");
    expect(merged).toHaveLength(1);
    const provn = merged[0]!.getProvN();
    expect(provn).toContain("10:00:00");
    expect(provn).not.toContain("11:00:00");
  });

  test('"last" keeps the latest-recorded value', () => {
    const u = conflictingStartTimes().unified({
      formalAttributeConflict: "last",
    });
    const merged = u.getRecord("ex:a");
    expect(merged).toHaveLength(1);
    const provn = merged[0]!.getProvN();
    expect(provn).toContain("11:00:00");
    expect(provn).not.toContain("10:00:00");
  });

  test("replayed observations (disjoint start/end) merge cleanly with no options", () => {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.activity("ex:a", T10, undefined); // start observed
    b.activity("ex:a", undefined, T11); // end observed on a later replay
    const merged = b.unified().getRecord("ex:a");
    expect(merged).toHaveLength(1);
    const provn = merged[0]!.getProvN();
    expect(provn).toContain("10:00:00"); // startTime survives
    expect(provn).toContain("11:00:00"); // endTime survives — no conflict
  });

  test("equal values for a single-valued formal attribute dedupe under every policy", () => {
    for (const policy of ["throw", "first", "last"] as const) {
      const b = new ProvBundle();
      b.addNamespace("ex", EX);
      b.activity("ex:a", T10);
      b.activity("ex:a", T10); // identical startTime — dedupes, never a conflict
      const u = b.unified({ formalAttributeConflict: policy });
      expect(u.getRecord("ex:a")).toHaveLength(1);
    }
  });

  test("resolves a conflicting QName-valued formal attribute under first/last", () => {
    function twoGenerations(): ProvBundle {
      const b = new ProvBundle();
      b.addNamespace("ex", EX);
      // Same relation identifier, different prov:activity → a formal-attribute
      // clash on a QName value (not a time literal).
      b.wasGeneratedBy("ex:e", "ex:a1", undefined, "ex:gen");
      b.wasGeneratedBy("ex:e", "ex:a2", undefined, "ex:gen");
      return b;
    }
    expect(() => twoGenerations().unified()).toThrow(
      "Cannot have more than one value for attribute prov:activity",
    );
    const first = twoGenerations()
      .unified({ formalAttributeConflict: "first" })
      .getRecord("ex:gen");
    expect(first[0]!.getProvN()).toContain("ex:a1");
    expect(first[0]!.getProvN()).not.toContain("ex:a2");
    const last = twoGenerations()
      .unified({ formalAttributeConflict: "last" })
      .getRecord("ex:gen");
    expect(last[0]!.getProvN()).toContain("ex:a2");
    expect(last[0]!.getProvN()).not.toContain("ex:a1");
  });
});

describe("ProvBundle.unified — singleValued (non-formal) attributes", () => {
  // A run activity re-declared with a genuinely different status — the shape a
  // budget-cancel that later resumes to completion produces on merge.
  function conflictingStatus(): ProvBundle {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.activity("ex:run", undefined, undefined, { "ex:status": "canceled" });
    b.activity("ex:run", undefined, undefined, { "ex:status": "completed" });
    return b;
  }

  test("default merge unions a non-formal attribute to multiple values", () => {
    const merged = conflictingStatus().unified().getRecord("ex:run");
    expect(merged).toHaveLength(1);
    const provn = merged[0]!.getProvN();
    expect(provn).toContain("canceled");
    expect(provn).toContain("completed"); // both survive — the multi-value problem
  });

  test('singleValued + "last" keeps only the latest value', () => {
    const merged = conflictingStatus()
      .unified({ formalAttributeConflict: "last", singleValued: ["ex:status"] })
      .getRecord("ex:run");
    expect(merged).toHaveLength(1);
    const provn = merged[0]!.getProvN();
    expect(provn).toContain("completed");
    expect(provn).not.toContain("canceled");
  });

  test('singleValued + "first" keeps only the earliest value', () => {
    const merged = conflictingStatus()
      .unified({ formalAttributeConflict: "first", singleValued: ["ex:status"] })
      .getRecord("ex:run");
    expect(merged).toHaveLength(1);
    const provn = merged[0]!.getProvN();
    expect(provn).toContain("canceled");
    expect(provn).not.toContain("completed");
  });

  test("identical re-emits of a single-valued non-formal attribute dedupe to one", () => {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.activity("ex:run", undefined, undefined, { "ex:status": "completed" });
    b.activity("ex:run", undefined, undefined, { "ex:status": "completed" });
    const merged = b
      .unified({ formalAttributeConflict: "last", singleValued: ["ex:status"] })
      .getRecord("ex:run");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.getProvN().match(/completed/g) ?? []).toHaveLength(1);
  });

  test("a non-formal attribute NOT named stays multi-valued under the policy", () => {
    const b = new ProvBundle();
    b.addNamespace("ex", EX);
    b.activity("ex:run", undefined, undefined, { "ex:note": "a" });
    b.activity("ex:run", undefined, undefined, { "ex:note": "b" });
    const provn = b
      .unified({ formalAttributeConflict: "last", singleValued: ["ex:status"] })
      .getRecord("ex:run")[0]!
      .getProvN();
    expect(provn).toContain('ex:note="a"');
    expect(provn).toContain('ex:note="b"'); // not named → still unions
  });
});

describe("ProvDocument.unified — formalAttributeConflict policy", () => {
  function docWithConflictInBundle(): ProvDocument {
    const d = new ProvDocument();
    d.addNamespace("ex", EX);
    const bnd = d.bundle("ex:bnd");
    bnd.activity("ex:a", T10);
    bnd.activity("ex:a", T11);
    return d;
  }

  test("propagates the policy into sub-bundles (default throws)", () => {
    expect(() => docWithConflictInBundle().unified()).toThrow(
      "Cannot have more than one value for attribute prov:startTime",
    );
  });

  test('"first" resolves conflicts inside a sub-bundle', () => {
    const u = docWithConflictInBundle().unified({
      formalAttributeConflict: "first",
    });
    const merged = u.bundles[0]!.getRecord("ex:a");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.getProvN()).toContain("10:00:00");
  });

  test('"last" resolves conflicts inside a sub-bundle', () => {
    const u = docWithConflictInBundle().unified({
      formalAttributeConflict: "last",
    });
    const merged = u.bundles[0]!.getRecord("ex:a");
    expect(merged).toHaveLength(1);
    expect(merged[0]!.getProvN()).toContain("11:00:00");
  });
});
