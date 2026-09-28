import { describe, expect, test } from "bun:test";
import type { BudgetStatus, ReviewTrace, ReviewTraceCall } from "@varroom/db";
import { formatBudget, formatDuration, formatResetTime, formatTrace } from "./traceFormat.ts";

// the trace formatting is pure, so these are plain unit tests on the printed text.

function call(overrides: Partial<ReviewTraceCall>): ReviewTraceCall {
  return {
    step: "MODERATOR",
    attempt: 1,
    claimOrder: null,
    model: "gemini-2.5-flash",
    status: "OK",
    error: null,
    inputTokens: 100,
    outputTokens: 20,
    thinkingTokens: 5,
    durationMs: 850,
    startedAt: new Date("2026-09-28T10:00:01Z"),
    ...overrides,
  };
}

// a finished review that took 12.5 seconds and made 3 calls
function trace(overrides: Partial<ReviewTrace>): ReviewTrace {
  return {
    id: "3f9a01bc-7d2e-4c1a-9b8e-5f6a7b8c9d0e",
    debateId: "8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
    status: "COMPLETE",
    createdAt: new Date("2026-09-28T10:00:00Z"),
    startedAt: new Date("2026-09-28T10:00:00.500Z"),
    completedAt: new Date("2026-09-28T10:00:13Z"),
    inputTokens: 300,
    outputTokens: 60,
    thinkingTokens: 15,
    aiCallCount: 3,
    callsDeleted: false,
    calls: [
      call({ step: "MODERATOR" }),
      call({
        step: "SEARCH",
        claimOrder: 1,
        status: "ERROR",
        error: "Gemini error 503: high demand",
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        durationMs: 1234,
      }),
      call({ step: "SEARCH", attempt: 2, claimOrder: 1 }),
    ],
    ...overrides,
  };
}

function budget(overrides: Partial<BudgetStatus>): BudgetStatus {
  return {
    limit: 100,
    used: 12,
    reserved: 16,
    left: 72,
    open: true,
    // midnight pacific, in summer time
    resetsAt: new Date("2026-09-29T07:00:00Z"),
    ...overrides,
  };
}

describe("formatDuration", () => {
  test("shows milliseconds under a second", () => {
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(0)).toBe("0ms");
  });

  test("shows seconds with one decimal from a second up", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(12_345)).toBe("12.3s");
  });
});

describe("formatTrace", () => {
  test("prints the status, debate id, duration and totals", () => {
    const text = formatTrace(trace({}));

    expect(text).toContain("=== Review 3f9a01bc-7d2e-4c1a-9b8e-5f6a7b8c9d0e ===");
    expect(text).toContain("Status: COMPLETE");
    expect(text).toContain("Debate: 8b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e");
    expect(text).toContain("Duration: 12.5s");
    expect(text).toContain("Totals: 3 calls, tokens in 300 / out 60 / thinking 15");
  });

  test("prints one numbered line per call, in the order given", () => {
    const text = formatTrace(trace({}));

    const moderatorAt = text.indexOf("1. MODERATOR attempt 1, OK, tokens in 100 / out 20 / thinking 5, 850ms");
    const failedAt = text.indexOf("2. SEARCH attempt 1 (claim 1), ERROR");
    const retryAt = text.indexOf("3. SEARCH attempt 2 (claim 1), OK");

    expect(moderatorAt).toBeGreaterThanOrEqual(0);
    expect(failedAt).toBeGreaterThan(moderatorAt);
    expect(retryAt).toBeGreaterThan(failedAt);
  });

  test("a failed call shows its raw error on the same line", () => {
    const text = formatTrace(trace({}));

    expect(text).toContain(
      "2. SEARCH attempt 1 (claim 1), ERROR, tokens in 0 / out 0 / thinking 0, 1.2s, error: Gemini error 503: high demand",
    );
  });

  test("an agent call has no claim number", () => {
    const text = formatTrace(trace({ calls: [call({ step: "FACT_CHECKER" })] }));

    expect(text).toContain("1. FACT_CHECKER attempt 1, OK,");
    expect(text).not.toContain("(claim");
  });

  test("a review that hasn't finished says it's still running", () => {
    const text = formatTrace(trace({ status: "RUNNING", completedAt: null }));

    expect(text).toContain("Status: RUNNING");
    expect(text).toContain("Duration: still running");
  });

  test("a review that failed before it ever started says so instead of a duration", () => {
    const text = formatTrace(trace({ status: "FAILED", startedAt: null, calls: [], aiCallCount: 0 }));

    expect(text).toContain("Duration: never started");
  });

  test("when the calls were cleaned up, it keeps the totals and says the detail is deleted after 48 hours", () => {
    const text = formatTrace(trace({ calls: [], callsDeleted: true }));

    expect(text).toContain("Totals: 3 calls, tokens in 300 / out 60 / thinking 15");
    expect(text).toContain("The per call detail is deleted after 48 hours.");
    expect(text).not.toContain("1. ");
  });

  test("a review with no calls yet says so", () => {
    const text = formatTrace(
      trace({ status: "QUEUED", startedAt: null, completedAt: null, calls: [], aiCallCount: 0 }),
    );

    expect(text).toContain("(no calls recorded yet)");
    expect(text).not.toContain("deleted after 48 hours");
  });
});

describe("formatResetTime", () => {
  test("shows utc first, then pacific time", () => {
    expect(formatResetTime(new Date("2026-09-29T07:00:00Z"))).toBe("2026-09-29 07:00 UTC (Sep 29, 12:00 AM PDT)");
  });

  test("uses standard time in winter, when pacific midnight is 08:00 utc", () => {
    expect(formatResetTime(new Date("2026-12-02T08:00:00Z"))).toBe("2026-12-02 08:00 UTC (Dec 2, 12:00 AM PST)");
  });
});

describe("formatBudget", () => {
  test("prints the limit, used, reserved, left and the reset time", () => {
    const text = formatBudget(budget({}));

    expect(text).toContain("=== Today's Gemini budget ===");
    expect(text).toContain("Daily limit: 100 calls");
    expect(text).toContain("Used today (since midnight Pacific): 12 calls");
    expect(text).toContain("Reserved by running reviews: 16 calls");
    expect(text).toContain("Left: 72 calls");
    expect(text).toContain("New reviews: open");
    expect(text).toContain("Resets at: 2026-09-29 07:00 UTC (Sep 29, 12:00 AM PDT)");
  });

  test("says new reviews are closed when one more review doesn't fit", () => {
    const text = formatBudget(budget({ used: 90, reserved: 0, left: 10, open: false }));

    expect(text).toContain("Left: 10 calls");
    expect(text).toContain("New reviews: closed until the reset");
  });
});
