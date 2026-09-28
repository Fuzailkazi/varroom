import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { prisma } from "@varroom/db/client";

// Runs the real CLI as a separate process. Only the paths that stop before
// any Gemini call are tested here; a full review needs a live Gemini key and
// is proven by running the CLI by hand. The database tests only run from the
// repo root, where the test preload points DATABASE_URL at the neon test branch.
const cliPath = join(import.meta.dir, "cli.ts");

const onTestDatabase =
  Boolean(process.env.DATABASE_URL_TEST) &&
  process.env.DATABASE_URL === process.env.DATABASE_URL_TEST;

function runCli(args: string[], env: Record<string, string | undefined>) {
  const result = Bun.spawnSync(["bun", cliPath, ...args], {
    // No --env-file and a fresh env, so the developer's .env can't leak in.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

describe("cli", () => {
  test("prints usage and exits 1 when no debate text is given", () => {
    const { exitCode, stderr } = runCli([], {});

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Usage: bun packages/agents/src/cli.ts "<debate text>"');
  });

  test("exits 1 and names the variable when VAR_CLI_USER_ID is missing", () => {
    const { exitCode, stderr } = runCli(["Bellingham is better as a 9"], { GEMINI_API_KEY: "x" });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("VAR_CLI_USER_ID is not set");
  });

  test("exits 1 and names the variable when GEMINI_API_KEY is missing", () => {
    const { exitCode, stderr } = runCli(["Bellingham is better as a 9"], { VAR_CLI_USER_ID: "user-1" });

    expect(exitCode).toBe(1);
    expect(stderr).toContain("GEMINI_API_KEY is not set");
  });

  test("exits 1 and names the variable when AI_DAILY_CALL_LIMIT isn't a positive whole number", () => {
    const { exitCode, stderr } = runCli(["Bellingham is better as a 9"], {
      VAR_CLI_USER_ID: "user-1",
      GEMINI_API_KEY: "x",
      AI_DAILY_CALL_LIMIT: "zero",
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('AI_DAILY_CALL_LIMIT must be a positive whole number, got "zero".');
  });
});

describe.skipIf(!onTestDatabase)("cli, on the test database", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: `cli-test-${crypto.randomUUID()}`,
        email: `cli-test-${crypto.randomUUID()}@varroom.test`,
        name: "Cli Test",
      },
    });
    userId = user.id;
  });

  // the test branch only, never the developer's dev database. the gemini key is a
  // dummy: these runs stop at the budget check, before any gemini call
  function cliEnv(aiDailyCallLimit: string) {
    return {
      DATABASE_URL: process.env.DATABASE_URL,
      VAR_CLI_USER_ID: userId,
      GEMINI_API_KEY: "not-a-real-key",
      AI_DAILY_CALL_LIMIT: aiDailyCallLimit,
    };
  }

  async function reviewsAndDebatesOfUser() {
    const debates = await prisma.debate.count({ where: { authorId: userId } });
    const reviews = await prisma.review.count({ where: { requestedById: userId } });
    return { debates: debates, reviews: reviews };
  }

  test("when today's budget can't fit a review, it prints the resting message, exits 1 and creates nothing", async () => {
    // a limit of 1 can never fit a review's 16 calls
    const { exitCode, stderr } = runCli(["Bellingham is better as a 9"], cliEnv("1"));

    expect(exitCode).toBe(1);
    expect(stderr).toContain("VAR is resting for today. Reviews open again at");
    // the throwaway debate is removed again, and no review row was made
    expect(await reviewsAndDebatesOfUser()).toEqual({ debates: 0, reviews: 0 });
  });

  test("when the database fails during the budget check, it exits 1 with a message and leaves no debate behind", async () => {
    // hides the ai_calls table for a moment, so the budget query really fails
    await prisma.$executeRawUnsafe(`ALTER TABLE "ai_calls" RENAME TO "ai_calls_hidden"`);
    let result: { exitCode: number; stderr: string };
    try {
      result = runCli(["Bellingham is better as a 9"], cliEnv("100"));
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "ai_calls_hidden" RENAME TO "ai_calls"`);
    }

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Could not check today's budget, no review was started");
    expect(await reviewsAndDebatesOfUser()).toEqual({ debates: 0, reviews: 0 });
  });
});
