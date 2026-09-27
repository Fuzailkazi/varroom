import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Runs the real CLI as a separate process. Only the paths that stop before
// any database or Gemini call are tested here; a full review needs a live
// Gemini key and is proven by running the CLI by hand.
const cliPath = join(import.meta.dir, "cli.ts");

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
});
