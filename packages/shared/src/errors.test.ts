import { describe, expect, test } from "bun:test";
import { ErrorResponse } from "./errors.ts";

// the shared error shape

describe("ErrorResponse", () => {
  test("accepts the plain code and message shape", () => {
    const result = ErrorResponse.safeParse({ error: { code: "NOT_FOUND", message: "No such debate." } });
    expect(result.success).toBe(true);
  });

  test("accepts the optional fields list from a validation error", () => {
    const result = ErrorResponse.safeParse({
      error: {
        code: "VALIDATION_FAILED",
        message: "Some inputs are not valid.",
        fields: [{ path: "tags.1", message: 'Unknown tag "nope".' }],
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts the optional existingId from a duplicate error, but only as a uuid", () => {
    const good = ErrorResponse.safeParse({
      error: { code: "DUPLICATE_DEBATE", message: "You already posted this.", existingId: "280c06dd-a9f8-41a7-9151-d348a6a7e295" },
    });
    expect(good.success).toBe(true);

    const bad = ErrorResponse.safeParse({
      error: { code: "DUPLICATE_DEBATE", message: "You already posted this.", existingId: "abc" },
    });
    expect(bad.success).toBe(false);
  });

  test("refuses a body without a code", () => {
    const result = ErrorResponse.safeParse({ error: { message: "Oops." } });
    expect(result.success).toBe(false);
  });
});
