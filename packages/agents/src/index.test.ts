import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@varroom/db/client";
import { createDebate, finishReviewFailed } from "@varroom/db";
import { geminiModel, runReview } from "./index.ts";
import type { RunAgentFn, SearchWebFn } from "./pipeline.ts";
import { PipelineError, ReviewStoppedError } from "./types.ts";
import type { AgentReply, SearchReply, TokenUsage, WebSource } from "./types.ts";

// integration tests for runReview: the real db, fake agents and fake search (no gemini calls).
// only run when the root test preload pointed DATABASE_URL at the neon test branch
// (bun test from the repo root), so they can never write to the dev db
const onTestDatabase =
  Boolean(process.env.DATABASE_URL_TEST) &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

const moderatorOutput = {
  claims: [
    {
      order: 1,
      claimText: "Bellingham is better as a false 9 than as an 8",
      type: "POSITIONAL_ROLE",
      entities: { player: "Bellingham", positionA: "false 9", positionB: "8" },
    },
    {
      order: 2,
      claimText: "Guardiola is overrated",
      type: "UNTESTABLE",
      entities: { player: "Guardiola", positionA: "" },
    },
  ],
};

// builds what one fake agent attempt returns: the json as text, plus optional token usage
function reply(json: object, usage: TokenUsage | null = null): AgentReply {
  return { text: JSON.stringify(json), usage: usage };
}

// builds what one fake search attempt returns
function found(sources: WebSource[], usage: TokenUsage | null = null): SearchReply {
  return { sources: sources, usage: usage };
}

// the pipeline always starts the fact checker prompt with "Claims:", so route on that
function fakeAgents(factCheckerOutput: object): RunAgentFn {
  return async (_agent, input) => {
    if (input.startsWith("Claims:")) {
      return reply(factCheckerOutput);
    }
    return reply(moderatorOutput);
  };
}

const bothSites: WebSource[] = [
  { url: "https://whoscored.com/a", title: "whoscored.com", publishedAt: null },
  { url: "https://fotmob.com/b", title: "fotmob.com", publishedAt: null },
];

const twoSources: SearchWebFn = async () => {
  return found(bothSites);
};

const verifiedWithBothSources = {
  verdicts: [{ claimOrder: 1, verdict: "VERIFIED", reasoning: "Both agree.", citedLabels: ["E1", "E2"] }],
};

let userId: string;

beforeAll(async () => {
  if (!onTestDatabase) return;
  const user = await prisma.user.create({
    data: {
      id: `review-test-${crypto.randomUUID()}`,
      email: `review-test-${crypto.randomUUID()}@varroom.test`,
      name: "Review Test",
    },
  });
  userId = user.id;
});

// helpers

// a fresh debate with a fresh QUEUED review, since a debate can only have one live review
async function newQueuedReview(): Promise<{ debateId: string; reviewId: string }> {
  const debateId = await createDebate({
    authorId: userId,
    title: "Bellingham false 9",
    thesis: "Bellingham is better as a false 9 than as an 8",
    categories: ["OTHER"],
    tagIds: [],
  });
  // seeded straight into the table: these tests are about running a review, not starting one
  const review = await prisma.review.create({
    data: { debateId: debateId, status: "QUEUED", model: "test-model", requestedById: userId },
  });
  return { debateId: debateId, reviewId: review.id };
}

// runs the review and hands back whatever it threw, or null
async function runAndCatch(reviewId: string, agents: RunAgentFn, search: SearchWebFn): Promise<unknown> {
  try {
    await runReview(reviewId, "text", { runAgentFn: agents, searchWebFn: search });
  } catch (err) {
    return err;
  }
  return null;
}

// like runAndCatch, with any pipeline options
async function runAndCatchWith(reviewId: string, options: Parameters<typeof runReview>[2]): Promise<unknown> {
  try {
    await runReview(reviewId, "text", options);
  } catch (err) {
    return err;
  }
  return null;
}

describe.skipIf(!onTestDatabase)("runReview", () => {
  test("saves a COMPLETE review with claims, entities, evidence, links and a summary", async () => {
    const { debateId, reviewId } = await newQueuedReview();

    const result = await runReview(reviewId, "text", {
      runAgentFn: fakeAgents(verifiedWithBothSources),
      searchWebFn: twoSources,
    });

    expect(result?.saved).toBe(true);

    const review = await prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
      include: {
        claims: { orderBy: { order: "asc" }, include: { citations: true } },
        evidence: { orderBy: { label: "asc" } },
      },
    });

    expect(review.status).toBe("COMPLETE");
    expect(review.decision).toBe("CONFIRMED");
    expect(review.credibilityScore).toBe(100);
    expect(review.summary).toBe("2 claims: 1 stands, 1 not testable");
    expect(review.startedAt).not.toBeNull();
    expect(review.completedAt).not.toBeNull();

    const testable = review.claims[0];
    const untestable = review.claims[1];
    expect(testable?.verdict).toBe("VERIFIED");
    expect(testable?.entities).toEqual({ player: "Bellingham", positionA: "false 9", positionB: "8" });
    expect(testable?.citations).toHaveLength(2);
    // untestable claims are never judged, so they stay PENDING in the db
    expect(untestable?.verdict).toBe("PENDING");

    expect(review.evidence).toHaveLength(2);
    expect(review.evidence[0]?.sourceTitle).toBe("whoscored.com");

    // the board's cached score follows the newest completed review
    const debate = await prisma.debate.findUniqueOrThrow({ where: { id: debateId } });
    expect(debate.credibilityScore).toBe(100);
  });

  test("deletes the review's progress events once it's saved", async () => {
    const { reviewId } = await newQueuedReview();
    await prisma.reviewEvent.create({
      data: { reviewId: reviewId, seq: 1, type: "claims_extracted", payload: {} },
    });

    await runReview(reviewId, "text", {
      runAgentFn: fakeAgents(verifiedWithBothSources),
      searchWebFn: twoSources,
    });

    const events = await prisma.reviewEvent.count({ where: { reviewId: reviewId } });
    expect(events).toBe(0);
  });

  test("a review with no score leaves the debate's last score alone", async () => {
    const { debateId, reviewId } = await newQueuedReview();
    await prisma.debate.update({ where: { id: debateId }, data: { credibilityScore: 70 } });

    // the fact checker cites nothing, so the only testable claim can't be scored
    await runReview(reviewId, "text", {
      runAgentFn: fakeAgents({ verdicts: [{ claimOrder: 1, verdict: "VERIFIED", reasoning: "x", citedLabels: [] }] }),
      searchWebFn: twoSources,
    });

    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.status).toBe("COMPLETE");
    expect(review.credibilityScore).toBeNull();
    expect(review.decision).toBe("INCONCLUSIVE");

    const debate = await prisma.debate.findUniqueOrThrow({ where: { id: debateId } });
    expect(debate.credibilityScore).toBe(70);
  });

  test("a broken moderator answer fails the review with the step name and throws", async () => {
    const { reviewId } = await newQueuedReview();
    const brokenModerator: RunAgentFn = async () => ({ text: "not json", usage: null });

    const thrown = await runAndCatch(reviewId, brokenModerator, twoSources);

    expect(thrown).toBeInstanceOf(PipelineError);
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toStartWith("moderator: Moderator failed");
    expect(review.completedAt).not.toBeNull();
  });

  test("when every search throws, the review fails at the search step", async () => {
    const { reviewId } = await newQueuedReview();
    const brokenSearch: SearchWebFn = async () => {
      throw new Error("quota exceeded");
    };

    const thrown = await runAndCatch(reviewId, fakeAgents(verifiedWithBothSources), brokenSearch);

    expect(thrown).toBeInstanceOf(PipelineError);
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toStartWith("search: Every search failed");
  });

  test("a review that ends during the moderator starts no more gemini calls", async () => {
    const { reviewId } = await newQueuedReview();

    // the review times out while the moderator is still thinking
    const slowModerator: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        return reply(verifiedWithBothSources);
      }
      await finishReviewFailed(reviewId, "timeout: took too long");
      return reply(moderatorOutput);
    };
    let searches = 0;
    const countingSearch: SearchWebFn = async () => {
      searches++;
      return found(bothSites);
    };

    const thrown = await runAndCatch(reviewId, slowModerator, countingSearch);

    expect(thrown).toBeInstanceOf(ReviewStoppedError);
    expect(searches).toBe(0);
    // the timeout's reason stays, the stop doesn't overwrite it
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId }, include: { claims: true } });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toBe("timeout: took too long");
    expect(review.claims).toHaveLength(0);

    // the moderator call that was already running is still recorded, nothing after it
    const calls = await prisma.aiCall.findMany({ where: { reviewId: reviewId } });
    expect(calls.map((call) => call.step)).toEqual(["MODERATOR"]);
    expect(review.aiCallCount).toBe(1);
  });

  test("a late result is dropped when the review ended during its last call", async () => {
    const { reviewId } = await newQueuedReview();

    // the review times out while the fact checker is still thinking
    const slowFactChecker: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        await finishReviewFailed(reviewId, "timeout: took too long");
        return reply(verifiedWithBothSources);
      }
      return reply(moderatorOutput);
    };

    const result = await runReview(reviewId, "text", { runAgentFn: slowFactChecker, searchWebFn: twoSources });

    expect(result?.saved).toBe(false);
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId }, include: { claims: true } });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toBe("timeout: took too long");
    expect(review.claims).toHaveLength(0);

    // the calls still happened, so they're still recorded against the review
    const calls = await prisma.aiCall.count({ where: { reviewId: reviewId } });
    expect(calls).toBe(3);
    expect(review.aiCallCount).toBe(3);
  });

  test("a stop from the caller (e.g. the api's timeout) starts no more gemini calls", async () => {
    const { reviewId } = await newQueuedReview();
    let searches = 0;
    const countingSearch: SearchWebFn = async () => {
      searches++;
      return found(bothSites);
    };

    const thrown = await runAndCatchWith(reviewId, {
      runAgentFn: fakeAgents(verifiedWithBothSources),
      searchWebFn: countingSearch,
      shouldStop: () => searches >= 1,
    });

    expect(thrown).toBeInstanceOf(ReviewStoppedError);
    const steps = await prisma.aiCall.findMany({ where: { reviewId: reviewId }, orderBy: { id: "asc" } });
    expect(steps.map((call) => call.step)).toEqual(["MODERATOR", "SEARCH"]);

    // whoever stops a review also ends it (the api's timeout fails it), so do that here,
    // or this RUNNING review would hold part of the daily budget in later test files
    await finishReviewFailed(reviewId, "timeout: test cleanup");
  });

  test("returns null and runs nothing when the review isn't QUEUED anymore", async () => {
    const { reviewId } = await newQueuedReview();
    await finishReviewFailed(reviewId, "restart: interrupted");

    let agentCalls = 0;
    const countingAgents: RunAgentFn = async () => {
      agentCalls++;
      return reply(moderatorOutput);
    };

    const result = await runReview(reviewId, "text", { runAgentFn: countingAgents, searchWebFn: twoSources });

    expect(result).toBeNull();
    expect(agentCalls).toBe(0);
  });

  test("saves one ai_calls row per attempt, retries included, and the totals are their sum", async () => {
    const { reviewId } = await newQueuedReview();

    const moderatorUsage = { inputTokens: 100, outputTokens: 20, thinkingTokens: 5 };
    const searchUsage = { inputTokens: 300, outputTokens: 40, thinkingTokens: 0 };
    const factCheckerUsage = { inputTokens: 200, outputTokens: 50, thinkingTokens: 12 };

    const agents: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        return reply(verifiedWithBothSources, factCheckerUsage);
      }
      return reply(moderatorOutput, moderatorUsage);
    };
    // the first search is too busy, the retry works
    let searches = 0;
    const busyOnce: SearchWebFn = async () => {
      searches++;
      if (searches === 1) {
        throw new Error("Gemini error 503: high demand");
      }
      return found(bothSites, searchUsage);
    };

    await runReview(reviewId, "text", { runAgentFn: agents, searchWebFn: busyOnce, retryDelayMs: 0 });

    const calls = await prisma.aiCall.findMany({ where: { reviewId: reviewId }, orderBy: { id: "asc" } });
    const summary: string[] = [];
    for (const call of calls) {
      summary.push(`${call.step} #${call.attempt} claim=${call.claimOrder} ${call.status}`);
    }
    expect(summary).toEqual([
      "MODERATOR #1 claim=null OK",
      "SEARCH #1 claim=1 ERROR",
      "SEARCH #2 claim=1 OK",
      "FACT_CHECKER #1 claim=null OK",
    ]);

    // the failed attempt keeps gemini's raw error and counts no tokens
    const failed = calls[1]!;
    expect(failed.error).toBe("Gemini error 503: high demand");
    expect(failed.inputTokens).toBe(0);
    expect(failed.outputTokens).toBe(0);
    expect(failed.thinkingTokens).toBe(0);

    const moderatorRow = calls[0]!;
    expect(moderatorRow.inputTokens).toBe(100);
    expect(moderatorRow.outputTokens).toBe(20);
    expect(moderatorRow.thinkingTokens).toBe(5);
    expect(moderatorRow.error).toBeNull();
    for (const call of calls) {
      expect(call.model).toBe(geminiModel());
      expect(call.durationMs).toBeGreaterThanOrEqual(0);
      expect(call.startedAt).toBeInstanceOf(Date);
    }

    // the review totals add up every row, and they aren't reset when the review completes
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.status).toBe("COMPLETE");
    expect(review.inputTokens).toBe(100 + 300 + 200);
    expect(review.outputTokens).toBe(20 + 40 + 50);
    expect(review.thinkingTokens).toBe(5 + 0 + 12);
    expect(review.aiCallCount).toBe(4);
    expect(review.costUsd).toBeNull();
  });

  test("a failed review still has its calls recorded", async () => {
    const { reviewId } = await newQueuedReview();
    const alwaysBusy: SearchWebFn = async () => {
      throw new Error("Gemini error 429: too many requests");
    };

    const thrown = await runAndCatchWith(reviewId, {
      runAgentFn: fakeAgents(verifiedWithBothSources),
      searchWebFn: alwaysBusy,
      retryDelayMs: 0,
    });

    expect(thrown).toBeInstanceOf(PipelineError);
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.status).toBe("FAILED");
    // the moderator, then the search twice before it gave up
    expect(review.aiCallCount).toBe(3);
    const errors = await prisma.aiCall.count({ where: { reviewId: reviewId, status: "ERROR" } });
    expect(errors).toBe(2);
  });

  test("a call that ends after the debate was deleted is kept with no review", async () => {
    const { debateId, reviewId } = await newQueuedReview();
    const startedBefore = new Date();

    // the debate (and its review) goes away while the moderator is thinking
    const moderatorOnDeletedDebate: RunAgentFn = async () => {
      await prisma.debate.delete({ where: { id: debateId } });
      return reply({ claims: [] }, { inputTokens: 7, outputTokens: 3, thinkingTokens: 0 });
    };

    const result = await runReview(reviewId, "text", { runAgentFn: moderatorOnDeletedDebate });

    expect(result?.saved).toBe(false);
    const orphans = await prisma.aiCall.findMany({
      where: { reviewId: null, step: "MODERATOR", startedAt: { gte: startedBefore }, inputTokens: 7 },
    });
    expect(orphans.length).toBeGreaterThanOrEqual(1);
    expect(orphans[0]?.status).toBe("OK");
  });
});
