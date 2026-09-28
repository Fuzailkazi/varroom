import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "./client.ts";
import { createDebate } from "./debates.ts";
import { deleteOldAiCalls, getReviewTrace, recordAiCall } from "./aiCalls.ts";
import type { NewAiCall } from "./aiCalls.ts";

// integration tests for recordAiCall on the neon test branch.
// only run when the root test preload pointed DATABASE_URL at the test branch
const onTestDatabase =
  Boolean(process.env.DATABASE_URL_TEST) &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

let userId: string;

// reviews this file leaves QUEUED. they're failed at the end, so they don't hold
// part of the daily budget in later test files
const liveReviewIds: string[] = [];

beforeAll(async () => {
  if (!onTestDatabase) return;
  const user = await prisma.user.create({
    data: {
      id: `ai-calls-test-${crypto.randomUUID()}`,
      email: `ai-calls-test-${crypto.randomUUID()}@varroom.test`,
      name: "Ai Calls Test",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  if (!onTestDatabase) return;
  await prisma.review.updateMany({
    where: { id: { in: liveReviewIds }, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", failureReason: "internal: test cleanup" },
  });
});

// helpers

// a fresh debate with a QUEUED review, returns both ids
async function newReview(): Promise<{ debateId: string; reviewId: string }> {
  const debateId = await createDebate({
    authorId: userId,
    title: "Saka as a 9",
    thesis: "Saka is better as a 9 than on the wing",
    categories: ["OTHER"],
    tagIds: [],
  });
  const review = await prisma.review.create({
    data: { debateId: debateId, status: "QUEUED", model: "test-model", requestedById: userId },
  });
  liveReviewIds.push(review.id);
  return { debateId: debateId, reviewId: review.id };
}

// one attempt, with whatever fields a test wants to change
function call(overrides: Partial<NewAiCall> = {}): NewAiCall {
  return {
    step: "MODERATOR",
    attempt: 1,
    claimOrder: null,
    model: "test-model",
    status: "OK",
    error: null,
    usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 5 },
    durationMs: 850,
    startedAt: new Date(),
    ...overrides,
  };
}

describe.skipIf(!onTestDatabase)("recordAiCall", () => {
  test("saves the row with every field", async () => {
    const { reviewId } = await newReview();
    const startedAt = new Date("2026-09-28T10:00:00.123Z");

    await recordAiCall(
      reviewId,
      call({ step: "SEARCH", attempt: 2, claimOrder: 3, model: "gemini-x", durationMs: 1234, startedAt: startedAt })
    );

    const rows = await prisma.aiCall.findMany({ where: { reviewId: reviewId } });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.step).toBe("SEARCH");
    expect(row.attempt).toBe(2);
    expect(row.claimOrder).toBe(3);
    expect(row.model).toBe("gemini-x");
    expect(row.status).toBe("OK");
    expect(row.error).toBeNull();
    expect(row.inputTokens).toBe(100);
    expect(row.outputTokens).toBe(20);
    expect(row.thinkingTokens).toBe(5);
    expect(row.durationMs).toBe(1234);
    expect(row.startedAt.toISOString()).toBe(startedAt.toISOString());
  });

  test("adds each call's tokens and one call to the review's totals", async () => {
    const { reviewId } = await newReview();

    await recordAiCall(reviewId, call({ usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 5 } }));
    await recordAiCall(reviewId, call({ step: "FACT_CHECKER", usage: { inputTokens: 50, outputTokens: 7, thinkingTokens: 1 } }));

    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.inputTokens).toBe(150);
    expect(review.outputTokens).toBe(27);
    expect(review.thinkingTokens).toBe(6);
    expect(review.aiCallCount).toBe(2);
    expect(review.costUsd).toBeNull();
  });

  test("a failed attempt keeps its error, counts 0 tokens, and still counts as a call", async () => {
    const { reviewId } = await newReview();

    await recordAiCall(reviewId, call({ status: "ERROR", error: "Gemini error 503: high demand", usage: null }));

    const row = await prisma.aiCall.findFirstOrThrow({ where: { reviewId: reviewId } });
    expect(row.status).toBe("ERROR");
    expect(row.error).toBe("Gemini error 503: high demand");
    expect(row.inputTokens).toBe(0);
    expect(row.outputTokens).toBe(0);
    expect(row.thinkingTokens).toBe(0);

    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.inputTokens).toBe(0);
    expect(review.aiCallCount).toBe(1);
  });

  test("rounds a fractional duration to whole milliseconds", async () => {
    const { reviewId } = await newReview();

    await recordAiCall(reviewId, call({ durationMs: 12.7 }));

    const row = await prisma.aiCall.findFirstOrThrow({ where: { reviewId: reviewId } });
    expect(row.durationMs).toBe(13);
  });

  test("when the review was deleted, the call is kept with no review and nothing throws", async () => {
    const { debateId, reviewId } = await newReview();
    await prisma.debate.delete({ where: { id: debateId } });
    const model = `deleted-review-${crypto.randomUUID()}`;

    await recordAiCall(reviewId, call({ model: model }));

    const rows = await prisma.aiCall.findMany({ where: { model: model } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reviewId).toBeNull();
  });

  test("says whether the review is still live, so the pipeline knows when to stop calling gemini", async () => {
    const { reviewId } = await newReview();
    const whileQueued = await recordAiCall(reviewId, call());
    expect(whileQueued).toBe(true);

    await prisma.review.update({ where: { id: reviewId }, data: { status: "RUNNING" } });
    const whileRunning = await recordAiCall(reviewId, call());
    expect(whileRunning).toBe(true);

    // e.g. the review timed out while this call was still running
    await prisma.review.update({ where: { id: reviewId }, data: { status: "FAILED" } });
    const afterItEnded = await recordAiCall(reviewId, call());
    expect(afterItEnded).toBe(false);

    // the late call is still counted
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.aiCallCount).toBe(3);
  });

  test("says the review is not live when it was deleted", async () => {
    const { debateId, reviewId } = await newReview();
    await prisma.debate.delete({ where: { id: debateId } });

    const live = await recordAiCall(reviewId, call({ model: `gone-${crypto.randomUUID()}` }));

    expect(live).toBe(false);
  });

  test("rows stay, with no review, when their review is deleted later, so they still count toward today", async () => {
    const { debateId, reviewId } = await newReview();
    const model = `later-deleted-${crypto.randomUUID()}`;
    await recordAiCall(reviewId, call({ model: model }));

    await prisma.debate.delete({ where: { id: debateId } });

    const rows = await prisma.aiCall.findMany({ where: { model: model } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reviewId).toBeNull();
  });
});

describe.skipIf(!onTestDatabase)("getReviewTrace", () => {
  test("returns null for a review that doesn't exist", async () => {
    const trace = await getReviewTrace(crypto.randomUUID());

    expect(trace).toBeNull();
  });

  test("returns the review's totals and its calls, oldest first", async () => {
    const { debateId, reviewId } = await newReview();
    // saved out of order on purpose, the trace must sort them by start time
    await recordAiCall(reviewId, call({ step: "FACT_CHECKER", startedAt: new Date("2026-09-28T10:00:03Z") }));
    await recordAiCall(reviewId, call({ step: "MODERATOR", startedAt: new Date("2026-09-28T10:00:01Z") }));
    await recordAiCall(
      reviewId,
      call({
        step: "SEARCH",
        claimOrder: 1,
        status: "ERROR",
        error: "Gemini error 503: high demand",
        usage: null,
        startedAt: new Date("2026-09-28T10:00:02Z"),
      })
    );

    const trace = await getReviewTrace(reviewId);

    expect(trace).not.toBeNull();
    expect(trace!.id).toBe(reviewId);
    expect(trace!.debateId).toBe(debateId);
    expect(trace!.status).toBe("QUEUED");
    expect(trace!.startedAt).toBeNull();
    expect(trace!.completedAt).toBeNull();
    expect(trace!.aiCallCount).toBe(3);
    expect(trace!.inputTokens).toBe(200);
    expect(trace!.outputTokens).toBe(40);
    expect(trace!.thinkingTokens).toBe(10);
    expect(trace!.callsDeleted).toBe(false);

    const steps: string[] = [];
    for (const row of trace!.calls) {
      steps.push(row.step);
    }
    expect(steps).toEqual(["MODERATOR", "SEARCH", "FACT_CHECKER"]);

    const search = trace!.calls[1]!;
    expect(search.claimOrder).toBe(1);
    expect(search.status).toBe("ERROR");
    expect(search.error).toBe("Gemini error 503: high demand");
    expect(search.inputTokens).toBe(0);
    expect(search.durationMs).toBe(850);
    expect(search.model).toBe("test-model");
  });

  test("two calls that start in the same millisecond keep the order they were saved in", async () => {
    const { reviewId } = await newReview();
    const sameTime = new Date("2026-09-28T11:00:00Z");
    await recordAiCall(reviewId, call({ step: "SEARCH", claimOrder: 1, startedAt: sameTime }));
    await recordAiCall(reviewId, call({ step: "SEARCH", claimOrder: 2, startedAt: sameTime }));

    const trace = await getReviewTrace(reviewId);

    expect(trace!.calls[0]!.claimOrder).toBe(1);
    expect(trace!.calls[1]!.claimOrder).toBe(2);
  });

  test("a review with no calls yet is not marked as cleaned up", async () => {
    const { reviewId } = await newReview();

    const trace = await getReviewTrace(reviewId);

    expect(trace!.calls).toEqual([]);
    expect(trace!.aiCallCount).toBe(0);
    expect(trace!.callsDeleted).toBe(false);
  });

  test("when the call rows were cleaned up, the totals stay and callsDeleted is true", async () => {
    const { reviewId } = await newReview();
    await recordAiCall(reviewId, call());
    await recordAiCall(reviewId, call({ step: "FACT_CHECKER" }));
    await prisma.aiCall.deleteMany({ where: { reviewId: reviewId } });

    const trace = await getReviewTrace(reviewId);

    expect(trace!.calls).toEqual([]);
    expect(trace!.aiCallCount).toBe(2);
    expect(trace!.inputTokens).toBe(200);
    expect(trace!.callsDeleted).toBe(true);
  });
});

// kept last in this file: it deletes every old row on the test branch, not only its own
describe.skipIf(!onTestDatabase)("deleteOldAiCalls", () => {
  const ONE_HOUR_MS = 60 * 60 * 1000;

  // a moment `hours` ago
  function hoursAgo(hours: number): Date {
    return new Date(Date.now() - hours * ONE_HOUR_MS);
  }

  test("deletes a call from 49 hours ago and keeps one from 47 hours ago", async () => {
    const { reviewId } = await newReview();
    await recordAiCall(reviewId, call({ step: "MODERATOR", startedAt: hoursAgo(49) }));
    await recordAiCall(reviewId, call({ step: "FACT_CHECKER", startedAt: hoursAgo(47) }));

    const deleted = await deleteOldAiCalls();

    // other test files may have left old rows too, so at least ours went
    expect(deleted).toBeGreaterThanOrEqual(1);
    const rows = await prisma.aiCall.findMany({ where: { reviewId: reviewId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.step).toBe("FACT_CHECKER");
  });

  test("leaves the review's totals as they were", async () => {
    const { reviewId } = await newReview();
    await recordAiCall(reviewId, call({ startedAt: hoursAgo(49) }));
    await recordAiCall(reviewId, call({ step: "FACT_CHECKER", startedAt: hoursAgo(47) }));

    await deleteOldAiCalls();

    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.aiCallCount).toBe(2);
    expect(review.inputTokens).toBe(200);
    expect(review.outputTokens).toBe(40);
    expect(review.thinkingTokens).toBe(10);
  });

  test("a review whose calls were all old shows callsDeleted in its trace, with its totals", async () => {
    const { reviewId } = await newReview();
    await recordAiCall(reviewId, call({ startedAt: hoursAgo(50) }));
    await recordAiCall(reviewId, call({ step: "FACT_CHECKER", startedAt: hoursAgo(49) }));

    await deleteOldAiCalls();

    const trace = await getReviewTrace(reviewId);
    expect(trace!.calls).toEqual([]);
    expect(trace!.aiCallCount).toBe(2);
    expect(trace!.inputTokens).toBe(200);
    expect(trace!.callsDeleted).toBe(true);
  });

  test("returns 0 when nothing is old enough, and recent calls stay", async () => {
    // the tests above already removed every old row
    await deleteOldAiCalls();
    const { reviewId } = await newReview();
    await recordAiCall(reviewId, call({ startedAt: new Date() }));

    const deleted = await deleteOldAiCalls();

    expect(deleted).toBe(0);
    const rows = await prisma.aiCall.findMany({ where: { reviewId: reviewId } });
    expect(rows).toHaveLength(1);
  });
});
