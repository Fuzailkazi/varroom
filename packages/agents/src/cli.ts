// VAR Room CLI: reviews a debate opinion from the terminal.
// Usage: bun packages/agents/src/cli.ts "<debate text>"
// Requires: GEMINI_API_KEY and VAR_CLI_USER_ID environment variables.

import { createDebate, deleteDebate, finishReviewFailed, startReviewLocked } from "@varroom/db";
import type { StartReviewResult } from "@varroom/db";
import { REVIEW_TIMEOUT_MS, dailyBudgetMessage, readUsageLimits } from "@varroom/shared";
import type { UsageLimits } from "@varroom/shared";
import { geminiModel, runReview } from "./index.ts";
import { PipelineError, ReviewStoppedError } from "./types.ts";
import { formatReview } from "./format.ts";
import { setupTracing } from "./telemetry.ts";

async function main() {
  const text = process.argv[2];
  if (!text) {
    console.error('Usage: bun packages/agents/src/cli.ts "<debate text>"');
    process.exit(1);
  }

  const userId = process.env.VAR_CLI_USER_ID;
  if (!userId) {
    console.error("VAR_CLI_USER_ID is not set. Set it to an existing user id.");
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set.");
    process.exit(1);
  }

  // the same daily budget the api uses, parsed the same way
  let limits: UsageLimits;
  try {
    limits = readUsageLimits(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // The CLI creates a throwaway debate to satisfy the reviews.debate_id constraint.
  let debateId: string;
  try {
    debateId = await createDebate({
      authorId: userId,
      title: text.slice(0, 120),
      thesis: text,
      categories: ["OTHER"],
      tagIds: [],
    });
  } catch (err) {
    console.error(
      "Failed to create debate row:",
      err instanceof Error ? err.message : String(err),
    );
    console.error(
      "Make sure VAR_CLI_USER_ID is a real user id from the dev database.",
    );
    process.exit(1);
  }

  // the review row comes first, through the same locked budget check as the api.
  // there's no fan session here, so the fan cap doesn't apply
  let started: StartReviewResult;
  try {
    started = await startReviewLocked({
      debateId: debateId,
      model: geminiModel(),
      requestedById: userId,
      fanDailyLimit: null,
      aiDailyCallLimit: limits.aiDailyCallLimit,
    });
  } catch (err) {
    // the database failed during the budget check, so nothing was started
    console.error(
      "Could not check today's budget, no review was started:",
      err instanceof Error ? err.message : String(err),
    );
    await deleteDebateQuietly(debateId);
    process.exit(1);
  }
  if (started.outcome === "budget") {
    // no review was created. drop the throwaway debate too, nothing will use it
    await deleteDebateQuietly(debateId);
    console.error(dailyBudgetMessage(started.resetsAt));
    process.exit(1);
  }
  if (started.outcome !== "created") {
    // can't happen for a debate we just made, but say so instead of running nothing
    console.error(`Could not start the review (${started.outcome}).`);
    process.exit(1);
  }
  const reviewId = started.review.id;

  console.log(`\nReviewing debate ${debateId}...\n`);

  // sends ADK's traces to Langfuse, only when both Langfuse keys are set. never throws
  setupTracing(process.env);

  // the same time limit as the api. once it passes, the review is failed and no new
  // gemini attempt starts: a review that old holds no daily budget any more
  let timedOut = false;
  const timer = setTimeout(async () => {
    timedOut = true;
    try {
      await finishReviewFailed(reviewId, `timeout: still running after ${Math.round(REVIEW_TIMEOUT_MS / 1000)}s`);
    } catch (err) {
      console.error("Could not time the review out:", err instanceof Error ? err.message : String(err));
    }
  }, REVIEW_TIMEOUT_MS);

  try {
    const result = await runReview(reviewId, text, { shouldStop: () => timedOut });
    if (!result) {
      console.error("The review was not QUEUED anymore, nothing to run.");
      process.exit(1);
    }
    console.log(formatReview(result));
  } catch (err) {
    if (err instanceof ReviewStoppedError) {
      console.error("\nThe review ended before it finished (it timed out, or its debate was deleted).");
    } else if (err instanceof PipelineError) {
      console.error(`\nPipeline failed at step "${err.step}": ${err.message}`);
    } else {
      console.error("\nPipeline failed:", err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

// drops the throwaway debate when no review will use it. if that fails too,
// say so and carry on: the caller is already exiting with an error
async function deleteDebateQuietly(debateId: string) {
  try {
    await deleteDebate(debateId);
  } catch (err) {
    console.error(`Could not delete the throwaway debate ${debateId}:`, err instanceof Error ? err.message : String(err));
  }
}

main();
