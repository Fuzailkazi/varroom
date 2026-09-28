import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { prisma } from "@varroom/db/client";
import { createDebate, recordAiCall } from "@varroom/db";

// Runs the real trace CLI as a separate process. The first tests stop before any
// database call, so they run anywhere. The rest read the neon test branch, so they
// only run from the repo root, where the test preload points DATABASE_URL at it.
const tracePath = join(import.meta.dir, "trace.ts");

const onTestDatabase =
  Boolean(process.env.DATABASE_URL_TEST) &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

function runTrace(args: string[], env: Record<string, string | undefined>) {
  const result = Bun.spawnSync(["bun", tracePath, ...args], {
    // No --env-file and a fresh env, so the developer's .env can't leak in.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

// the test branch only. never the developer's dev database
function testDatabaseEnv() {
  return { DATABASE_URL: process.env.DATABASE_URL };
}

describe("trace cli, before the database", () => {
  test("a malformed review id prints a clear message and exits 1", () => {
    const { exitCode, stderr } = runTrace(["not-a-review"], {});

    expect(exitCode).toBe(1);
    expect(stderr).toContain('"not-a-review" is not a review id.');
  });

  test("with no id, a bad AI_DAILY_CALL_LIMIT names the variable and exits 1", () => {
    const { exitCode, stderr } = runTrace([], { AI_DAILY_CALL_LIMIT: "-5" });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('AI_DAILY_CALL_LIMIT must be a positive whole number, got "-5".');
  });
});

describe.skipIf(!onTestDatabase)("trace cli, on the test database", () => {
  let userId: string;
  const liveReviewIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: `trace-cli-test-${crypto.randomUUID()}`,
        email: `trace-cli-test-${crypto.randomUUID()}@varroom.test`,
        name: "Trace Cli Test",
      },
    });
    userId = user.id;
  });

  // a queued review counts toward the reserve, so don't leave it behind for later test files
  afterAll(async () => {
    await prisma.review.updateMany({
      where: { id: { in: liveReviewIds }, status: { in: ["QUEUED", "RUNNING"] } },
      data: { status: "FAILED", failureReason: "internal: test cleanup" },
    });
  });

  async function newReview(): Promise<string> {
    const debateId = await createDebate({
      authorId: userId,
      title: "Odegaard as a 10",
      thesis: "Odegaard is better as a 10 than as an 8",
      categories: ["OTHER"],
      tagIds: [],
    });
    const review = await prisma.review.create({
      data: { debateId: debateId, status: "QUEUED", model: "test-model", requestedById: userId },
    });
    liveReviewIds.push(review.id);
    return review.id;
  }

  test("an unknown review id prints a clear message and exits 1", () => {
    const unknownId = crypto.randomUUID();

    const { exitCode, stderr } = runTrace([unknownId], testDatabaseEnv());

    expect(exitCode).toBe(1);
    expect(stderr).toContain(`No review with id ${unknownId}.`);
  });

  test("a review id prints its status, totals and one line per call", async () => {
    const reviewId = await newReview();
    await recordAiCall(reviewId, {
      step: "MODERATOR",
      attempt: 1,
      claimOrder: null,
      model: "test-model",
      status: "OK",
      error: null,
      usage: { inputTokens: 100, outputTokens: 20, thinkingTokens: 5 },
      durationMs: 850,
      startedAt: new Date(Date.now() - 2000),
    });
    await recordAiCall(reviewId, {
      step: "SEARCH",
      attempt: 1,
      claimOrder: 1,
      model: "test-model",
      status: "ERROR",
      error: "Gemini error 503: high demand",
      usage: null,
      durationMs: 1500,
      startedAt: new Date(Date.now() - 1000),
    });

    const { exitCode, stdout } = runTrace([reviewId], testDatabaseEnv());

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Status: QUEUED");
    expect(stdout).toContain("Duration: still running");
    expect(stdout).toContain("Totals: 2 calls, tokens in 100 / out 20 / thinking 5");
    expect(stdout).toContain("1. MODERATOR attempt 1, OK");
    expect(stdout).toContain("2. SEARCH attempt 1 (claim 1), ERROR, tokens in 0 / out 0 / thinking 0, 1.5s, error: Gemini error 503: high demand");
  });

  test("with no id, prints today's budget with the given limit", () => {
    const { exitCode, stdout } = runTrace([], { ...testDatabaseEnv(), AI_DAILY_CALL_LIMIT: "1000000" });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("=== Today's Gemini budget ===");
    expect(stdout).toContain("Daily limit: 1000000 calls");
    expect(stdout).toContain("New reviews: open");
    expect(stdout).toMatch(/Resets at: \d{4}-\d{2}-\d{2} \d{2}:00 UTC \(\w{3} \d{1,2}, 12:00 AM P[DS]T\)/);
  });
});
