import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@varroom/db/client";
import { createDebate, createReview, finishReviewFailed } from "@varroom/db";
import { runReview } from "./index.ts";
import type { RunAgentFn, SearchWebFn } from "./pipeline.ts";
import { PipelineError } from "./types.ts";

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

// the pipeline always starts the fact checker prompt with "Claims:", so route on that
function fakeAgents(factCheckerOutput: object): RunAgentFn {
  return async (_agent, input) => {
    if (input.startsWith("Claims:")) {
      return JSON.stringify(factCheckerOutput);
    }
    return JSON.stringify(moderatorOutput);
  };
}

const twoSources: SearchWebFn = async () => {
  return [
    { url: "https://whoscored.com/a", title: "whoscored.com", publishedAt: null },
    { url: "https://fotmob.com/b", title: "fotmob.com", publishedAt: null },
  ];
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
  const created = await createReview({ debateId: debateId, model: "test-model", requestedById: userId });
  return { debateId: debateId, reviewId: created.review.id };
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
    const brokenModerator: RunAgentFn = async () => "not json";

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

  test("a late result is dropped when the review already ended (e.g. it timed out)", async () => {
    const { reviewId } = await newQueuedReview();

    // the review times out while the moderator is still thinking
    const slowModerator: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        return JSON.stringify(verifiedWithBothSources);
      }
      await finishReviewFailed(reviewId, "timeout: took too long");
      return JSON.stringify(moderatorOutput);
    };

    const result = await runReview(reviewId, "text", { runAgentFn: slowModerator, searchWebFn: twoSources });

    expect(result?.saved).toBe(false);
    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId }, include: { claims: true } });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toBe("timeout: took too long");
    expect(review.claims).toHaveLength(0);
  });

  test("returns null and runs nothing when the review isn't QUEUED anymore", async () => {
    const { reviewId } = await newQueuedReview();
    await finishReviewFailed(reviewId, "restart: interrupted");

    let agentCalls = 0;
    const countingAgents: RunAgentFn = async () => {
      agentCalls++;
      return JSON.stringify(moderatorOutput);
    };

    const result = await runReview(reviewId, "text", { runAgentFn: countingAgents, searchWebFn: twoSources });

    expect(result).toBeNull();
    expect(agentCalls).toBe(0);
  });
});
