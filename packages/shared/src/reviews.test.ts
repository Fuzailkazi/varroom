import { describe, expect, test } from "bun:test";
import { AvailabilityResponse, dailyBudgetMessage, readUsageLimits } from "./reviews.ts";

// the usage limits read from env vars, and the closed for today message

describe("readUsageLimits", () => {
  test("uses 100 calls a day and 3 reviews per fan when nothing is set", () => {
    expect(readUsageLimits({})).toEqual({ aiDailyCallLimit: 100, reviewDailyLimit: 3 });
  });

  test("reads both limits from their env vars", () => {
    const limits = readUsageLimits({ AI_DAILY_CALL_LIMIT: "250", REVIEW_DAILY_LIMIT: "10" });
    expect(limits).toEqual({ aiDailyCallLimit: 250, reviewDailyLimit: 10 });
  });

  test("a blank value counts as not set", () => {
    const limits = readUsageLimits({ AI_DAILY_CALL_LIMIT: "", REVIEW_DAILY_LIMIT: "  " });
    expect(limits).toEqual({ aiDailyCallLimit: 100, reviewDailyLimit: 3 });
  });

  test("spaces around a number are fine", () => {
    expect(readUsageLimits({ AI_DAILY_CALL_LIMIT: " 42 " }).aiDailyCallLimit).toBe(42);
  });

  test("1 is the smallest allowed limit", () => {
    expect(readUsageLimits({ REVIEW_DAILY_LIMIT: "1" }).reviewDailyLimit).toBe(1);
  });

  test("zero is refused, naming the variable", () => {
    expect(() => readUsageLimits({ AI_DAILY_CALL_LIMIT: "0" })).toThrow(
      'AI_DAILY_CALL_LIMIT must be a positive whole number, got "0".',
    );
  });

  test("negative numbers, decimals and words are refused", () => {
    expect(() => readUsageLimits({ REVIEW_DAILY_LIMIT: "-3" })).toThrow("REVIEW_DAILY_LIMIT");
    expect(() => readUsageLimits({ REVIEW_DAILY_LIMIT: "2.5" })).toThrow("REVIEW_DAILY_LIMIT");
    expect(() => readUsageLimits({ AI_DAILY_CALL_LIMIT: "lots" })).toThrow("AI_DAILY_CALL_LIMIT");
    expect(() => readUsageLimits({ AI_DAILY_CALL_LIMIT: "1e3" })).toThrow("AI_DAILY_CALL_LIMIT");
  });

  test("a number too big to count exactly is refused", () => {
    expect(() => readUsageLimits({ AI_DAILY_CALL_LIMIT: "99999999999999999999" })).toThrow("AI_DAILY_CALL_LIMIT");
  });
});

describe("dailyBudgetMessage", () => {
  test("says when reviews open again, in pacific time and utc", () => {
    // midnight pacific during summer time is 07:00 utc
    const message = dailyBudgetMessage(new Date("2026-09-29T07:00:00.000Z"));
    expect(message).toBe("VAR is resting for today. Reviews open again at 12:00 AM PDT (07:00 UTC).");
  });

  test("in winter pacific midnight is 08:00 utc", () => {
    const message = dailyBudgetMessage(new Date("2026-12-01T08:00:00.000Z"));
    expect(message).toBe("VAR is resting for today. Reviews open again at 12:00 AM PST (08:00 UTC).");
  });
});

describe("AvailabilityResponse", () => {
  test("accepts open and resetsAt", () => {
    const result = AvailabilityResponse.safeParse({ open: true, resetsAt: "2026-09-29T07:00:00.000Z" });
    expect(result.success).toBe(true);
  });

  test("refuses a resetsAt that isn't an iso time", () => {
    const result = AvailabilityResponse.safeParse({ open: false, resetsAt: "tomorrow" });
    expect(result.success).toBe(false);
  });
});
