import { test, expect } from "bun:test";

import { greet } from "./index";

test("greet builds a message for the recipient", () => {
  const result = greet("Bun");

  expect(result.recipient).toBe("Bun");
  expect(result.message).toBe("Hello, Bun!");
});
