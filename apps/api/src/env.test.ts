import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { loadEnv } from "./env.ts";

const valid = {
  DATABASE_URL: "postgresql://u:p@host/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
};

test("parses a valid environment and defaults PORT and NODE_ENV", () => {
  const env = loadEnv(valid);
  expect(env.PORT).toBe(3000);
  expect(env.NODE_ENV).toBe("development");
});

test("the usage limits default to 100 gemini calls a day and 3 reviews per fan", () => {
  const env = loadEnv(valid);
  expect(env.aiDailyCallLimit).toBe(100);
  expect(env.reviewDailyLimit).toBe(3);
});

test("the usage limits come from AI_DAILY_CALL_LIMIT and REVIEW_DAILY_LIMIT", () => {
  const env = loadEnv({ ...valid, AI_DAILY_CALL_LIMIT: "40", REVIEW_DAILY_LIMIT: "5" });
  expect(env.aiDailyCallLimit).toBe(40);
  expect(env.reviewDailyLimit).toBe(5);
});

test("development boots without an email provider", () => {
  expect(loadEnv(valid).RESEND_API_KEY).toBeUndefined();
});

describe("when the environment is invalid", () => {
  let exit: ReturnType<typeof spyOn>;
  let error: ReturnType<typeof spyOn>;
  beforeEach(() => {
    exit = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    error = spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    exit.mockRestore();
    error.mockRestore();
  });
  const message = () => String(error.mock.calls[0]?.[0]);

  test("stops the process naming DATABASE_URL when it is missing", () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: undefined })).toThrow("exit");
    expect(message()).toContain("DATABASE_URL");
  });

  test("refuses a BETTER_AUTH_SECRET shorter than 32 characters", () => {
    expect(() => loadEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow("exit");
    expect(message()).toContain("BETTER_AUTH_SECRET");
  });

  test("stops the process naming AI_DAILY_CALL_LIMIT when it isn't a positive whole number", () => {
    expect(() => loadEnv({ ...valid, AI_DAILY_CALL_LIMIT: "-1" })).toThrow("exit");
    expect(message()).toContain("AI_DAILY_CALL_LIMIT must be a positive whole number");
  });

  test("stops the process naming REVIEW_DAILY_LIMIT when it is zero", () => {
    expect(() => loadEnv({ ...valid, REVIEW_DAILY_LIMIT: "0" })).toThrow("exit");
    expect(message()).toContain("REVIEW_DAILY_LIMIT");
  });

  test("production refuses to boot without RESEND_API_KEY and EMAIL_FROM", () => {
    expect(() => loadEnv({ ...valid, NODE_ENV: "production" })).toThrow("exit");
    expect(message()).toContain("RESEND_API_KEY");
    expect(message()).toContain("EMAIL_FROM");
  });
});
