import { afterEach, describe, expect, test } from "bun:test";
import { checkDatabase } from "./health.ts";

describe("checkDatabase", () => {
  const original = process.env.DATABASE_URL;
  afterEach(() => {
    process.env.DATABASE_URL = original;
  });

  test("reports down, without throwing, when no database is configured", async () => {
    delete process.env.DATABASE_URL;
    expect(await checkDatabase()).toBe("down");
  });

  test.skipIf(!original)("reports up against the configured Neon branch", async () => {
    expect(await checkDatabase()).toBe("up");
  });
});
