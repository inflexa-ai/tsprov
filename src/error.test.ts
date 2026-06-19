import { test, expect, describe } from "bun:test";

import {
  ProvError,
  ProvException,
  ProvExceptionInvalidQualifiedName,
  ProvElementIdentifierRequired,
  setWarningHandler,
  warn,
} from "./error.js";

describe("exception hierarchy", () => {
  test("ProvError is a native Error with the right name", () => {
    const e = new ProvError("boom");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ProvError");
    expect(e.message).toBe("boom");
  });

  test("ProvException extends ProvError", () => {
    const e = new ProvException("x");
    expect(e).toBeInstanceOf(ProvError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ProvException");
  });

  test("ProvExceptionInvalidQualifiedName carries the offending name", () => {
    const e = new ProvExceptionInvalidQualifiedName("ex:bad name");
    expect(e).toBeInstanceOf(ProvException);
    expect(e.qname).toBe("ex:bad name");
    expect(e.message).toBe("Invalid Qualified Name: ex:bad name");
  });

  test("ProvElementIdentifierRequired has the canonical message", () => {
    const e = new ProvElementIdentifierRequired();
    expect(e).toBeInstanceOf(ProvException);
    expect(e.message).toContain("All PROV elements require a valid identifier");
  });
});

describe("warning callback", () => {
  test("warn() routes through the installed handler", () => {
    const captured: string[] = [];
    try {
      setWarningHandler((m) => captured.push(m));
      warn("heads up");
      expect(captured).toEqual(["heads up"]);
    } finally {
      // Restore a console.warn-backed handler so other test files (which spy on
      // console.warn) see warnings again.
      setWarningHandler((m) => console.warn(m));
    }
  });
});
