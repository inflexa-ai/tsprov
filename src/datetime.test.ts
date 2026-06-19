import { test, expect, describe } from "bun:test";
import { DateTime } from "luxon";

import { ensureDateTime, parseXsdDateTime, toXsdDateTime } from "./datetime";

describe("ensureDateTime", () => {
  test("passes through null/undefined as null", () => {
    expect(ensureDateTime(null)).toBeNull();
    expect(ensureDateTime(undefined)).toBeNull();
  });

  test("passes a DateTime through unchanged (same instance)", () => {
    const dt = DateTime.fromISO("2024-01-01T00:00:00+00:00", { setZone: true });
    expect(ensureDateTime(dt)).toBe(dt);
  });

  test("wraps a JS Date", () => {
    const out = ensureDateTime(new Date("2024-01-01T00:00:00Z"));
    expect(out).toBeInstanceOf(DateTime);
    expect(out!.toUTC().toISO()).toContain("2024-01-01T00:00:00");
  });

  test("parses an ISO string, preserving the offset", () => {
    const out = ensureDateTime("2024-06-18T09:00:00+01:00");
    expect(out!.isValid).toBe(true);
    expect(out!.offset).toBe(60); // +01:00 preserved (minutes)
  });

  test("throws on an invalid datetime string", () => {
    expect(() => ensureDateTime("not-a-date")).toThrow("Invalid datetime");
  });
});

describe("parseXsdDateTime", () => {
  test("returns a DateTime for valid ISO", () => {
    expect(parseXsdDateTime("2024-01-01T00:00:00+00:00")!.isValid).toBe(true);
  });

  test("returns null for invalid input (does not throw)", () => {
    expect(parseXsdDateTime("garbage")).toBeNull();
  });
});

describe("toXsdDateTime", () => {
  // Each expected value is the actual Python `dateutil.parse(s).isoformat()`
  // output, verified against the reference venv.
  test.each([
    ["2024-01-01T00:00:00+00:00", "2024-01-01T00:00:00+00:00"],
    ["2024-06-18T09:00:00+01:00", "2024-06-18T09:00:00+01:00"],
    ["2024-01-01T09:00:00.500000+00:00", "2024-01-01T09:00:00.500000+00:00"],
    ["2024-01-01T09:00:00-05:00", "2024-01-01T09:00:00-05:00"],
  ])("formats %s like Python isoformat()", (input, expected) => {
    expect(toXsdDateTime(parseXsdDateTime(input)!)).toBe(expected);
  });

  test("emits +00:00 for UTC, never Z", () => {
    expect(toXsdDateTime(parseXsdDateTime("2024-01-01T09:00:00Z")!)).toBe(
      "2024-01-01T09:00:00+00:00",
    );
  });

  test("round-trips parse → format for an offset timestamp", () => {
    const s = "2024-06-18T09:30:00+02:00";
    expect(toXsdDateTime(parseXsdDateTime(s)!)).toBe(s);
  });
});
