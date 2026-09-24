import { describe, expect, test } from "bun:test";
import { HealthResponse } from "./health.ts";

describe("HealthResponse", () => {
  test("accepts a healthy response", () => {
    const parsed = HealthResponse.parse({
      status: "ok",
      database: "up",
      time: new Date().toISOString(),
    });
    expect(parsed.database).toBe("up");
  });

  test("rejects an unknown database state", () => {
    const result = HealthResponse.safeParse({
      status: "ok",
      database: "sleepy",
      time: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});
