import { describe, expect, test } from "bun:test";
import { AdminReviewTraceResponse } from "./admin.ts";

// a trace with one failed search, the shape the admin endpoint sends
function traceBody() {
  return {
    review: {
      id: "review-1",
      debateId: "debate-1",
      status: "RUNNING",
      createdAt: "2026-09-28T10:00:00.000Z",
      startedAt: "2026-09-28T10:00:01.000Z",
      completedAt: null,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      aiCallCount: 1,
      callsDeleted: false,
    },
    calls: [
      {
        step: "SEARCH",
        attempt: 1,
        claimOrder: 1,
        model: "gemini-2.5-flash",
        status: "ERROR",
        error: "Gemini error 503: high demand",
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        durationMs: 1200,
        startedAt: "2026-09-28T10:00:02.000Z",
      },
    ],
  };
}

describe("AdminReviewTraceResponse", () => {
  test("accepts a running review with a failed call and its raw error", () => {
    const parsed = AdminReviewTraceResponse.parse(traceBody());

    expect(parsed.review.completedAt).toBeNull();
    expect(parsed.calls[0]?.error).toBe("Gemini error 503: high demand");
  });

  test("rejects a call with an unknown step", () => {
    const body = traceBody();
    body.calls[0]!.step = "SCOUT";

    const result = AdminReviewTraceResponse.safeParse(body);

    expect(result.success).toBe(false);
  });

  test("rejects a review without the callsDeleted flag", () => {
    const body: any = traceBody();
    delete body.review.callsDeleted;

    const result = AdminReviewTraceResponse.safeParse(body);

    expect(result.success).toBe(false);
  });
});
