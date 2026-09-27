import { beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "@varroom/db/client";
import { createDebate } from "@varroom/db";
import { reviewDebate } from "./index.ts";
import type { RunAgentFn, SearchWebFn } from "./pipeline.ts";
import { PipelineError } from "./types.ts";

// Integration tests for reviewDebate: the real database layer, with fake
// agents and a fake search so no Gemini call is made.
//
// They only run when the root test preload has pointed DATABASE_URL at the
// Neon test branch (run `bun test` from the repo root). Anywhere else, for
// example `bun test` inside packages/agents, they are skipped so they can
// never write to the dev database.
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

// Routes on the input: the pipeline always starts the Fact Checker prompt with "Claims:".
function fakeAgents(factCheckerOutput: object): RunAgentFn {
  return async (_agent, input) =>
    JSON.stringify(input.startsWith("Claims:") ? factCheckerOutput : moderatorOutput);
}

const twoSources: SearchWebFn = async () => [
  { url: "https://whoscored.com/a", title: "whoscored.com", publishedAt: null },
  { url: "https://fotmob.com/b", title: "fotmob.com", publishedAt: null },
];

let debateId: string;

beforeAll(async () => {
  if (!onTestDatabase) return;
  const user = await prisma.user.create({
    data: {
      id: `review-test-${crypto.randomUUID()}`,
      email: `review-test-${crypto.randomUUID()}@varroom.test`,
      name: "Review Test",
    },
  });
  debateId = await createDebate({
    authorId: user.id,
    title: "Bellingham false 9",
    thesis: "Bellingham is better as a false 9 than as an 8",
    categories: ["OTHER"],
    tagIds: [],
  });
});

describe.skipIf(!onTestDatabase)("reviewDebate", () => {
  // covers: AC-9, AC-11
  test("saves a COMPLETE review with its claims, evidence, and citation links", async () => {
    const result = await reviewDebate(debateId, "Bellingham is better as a false 9 than as an 8", {
      runAgentFn: fakeAgents({
        verdicts: [{ claimOrder: 1, verdict: "VERIFIED", reasoning: "Both agree.", citedLabels: ["E1", "E2"] }],
      }),
      searchWebFn: twoSources,
    });

    const review = await prisma.review.findUniqueOrThrow({
      where: { id: result.reviewId },
      include: {
        claims: { orderBy: { order: "asc" }, include: { citations: true } },
        evidence: { orderBy: { label: "asc" } },
      },
    });

    expect(review.status).toBe("COMPLETE");
    expect(review.decision).toBe("CONFIRMED");
    expect(review.credibilityScore).toBe(100);
    expect(review.startedAt).not.toBeNull();
    expect(review.completedAt).not.toBeNull();

    const [testable, untestable] = review.claims;
    expect(testable?.verdict).toBe("VERIFIED");
    expect(testable?.confidence).toBe(0.8);
    expect(testable?.citations).toHaveLength(2);
    // Untestable claims are never judged, so they stay PENDING in the database.
    expect(untestable?.type).toBe("UNTESTABLE");
    expect(untestable?.verdict).toBe("PENDING");

    expect(review.evidence.map((row) => row.label)).toEqual(["E1", "E2"]);
    expect(review.evidence.at(0)).toMatchObject({
      kind: "WEB",
      toolName: "searchWeb",
      sourceUrl: "https://whoscored.com/a",
      sourceTitle: "whoscored.com",
      publishedAt: null,
      error: null,
    });
    expect(review.evidence.at(0)?.args).toEqual({
      claimOrder: 1,
      query: "Bellingham false 9 vs 8 stats",
    });
  });

  // covers: AC-7
  test("copies the review's score onto the debate", async () => {
    await reviewDebate(debateId, "text", {
      runAgentFn: fakeAgents({
        verdicts: [{ claimOrder: 1, verdict: "PARTIALLY_TRUE", reasoning: "Mixed.", citedLabels: ["E1"] }],
      }),
      searchWebFn: twoSources,
    });

    const debate = await prisma.debate.findUniqueOrThrow({ where: { id: debateId } });
    expect(debate.credibilityScore).toBe(50);
  });

  // covers: AC-5, AC-7
  test("a failed search saves an error evidence row and a null, INCONCLUSIVE score", async () => {
    const before = await prisma.debate.findUniqueOrThrow({ where: { id: debateId } });

    const result = await reviewDebate(debateId, "text", {
      runAgentFn: fakeAgents({ verdicts: [] }),
      searchWebFn: async () => {
        throw new Error("search down");
      },
    });

    const review = await prisma.review.findUniqueOrThrow({
      where: { id: result.reviewId },
      include: { claims: { orderBy: { order: "asc" } }, evidence: true },
    });
    expect(review.status).toBe("COMPLETE");
    expect(review.decision).toBe("INCONCLUSIVE");
    expect(review.credibilityScore).toBeNull();
    expect(review.claims.at(0)?.verdict).toBe("INSUFFICIENT_DATA");
    expect(review.evidence).toHaveLength(1);
    expect(review.evidence.at(0)?.error).toBe("search down");

    // A null score must not wipe the debate's last real score.
    const after = await prisma.debate.findUniqueOrThrow({ where: { id: debateId } });
    expect(after.credibilityScore).toBe(before.credibilityScore);
  });

  // covers: AC-10
  test("an agent failure marks the review FAILED with the step name and rethrows", async () => {
    const brokenModerator: RunAgentFn = async () => "not json";

    let thrown: unknown;
    try {
      await reviewDebate(debateId, "text", { runAgentFn: brokenModerator, searchWebFn: twoSources });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PipelineError);
    expect((thrown as PipelineError).step).toBe("moderator");

    const review = await prisma.review.findFirstOrThrow({
      where: { debateId },
      orderBy: { createdAt: "desc" },
    });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toStartWith("moderator: Moderator failed");
    expect(review.completedAt).not.toBeNull();
  });

  // covers: AC-10
  test("a Fact Checker answer that breaks the schema fails the review at the fact_checker step", async () => {
    let thrown: unknown;
    try {
      await reviewDebate(debateId, "text", {
        runAgentFn: fakeAgents({ verdicts: [{ claimOrder: 1, verdict: "MAYBE" }] }),
        searchWebFn: twoSources,
      });
    } catch (err) {
      thrown = err;
    }

    expect((thrown as PipelineError).step).toBe("fact_checker");

    const review = await prisma.review.findFirstOrThrow({
      where: { debateId },
      orderBy: { createdAt: "desc" },
      include: { evidence: true },
    });
    expect(review.status).toBe("FAILED");
    expect(review.failureReason).toStartWith("fact_checker:");
  });
});
