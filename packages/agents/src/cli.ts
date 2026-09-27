// VAR Room CLI: reviews a debate opinion from the terminal.
// Usage: bun packages/agents/src/cli.ts "<debate text>"
// Requires: GEMINI_API_KEY and VAR_CLI_USER_ID environment variables.

import { createDebate, createReview } from "@varroom/db";
import { geminiModel, runReview } from "./index.ts";
import { PipelineError } from "./types.ts";
import { formatReview } from "./format.ts";

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

  // the review row comes first, the same way the api does it
  const created = await createReview({ debateId: debateId, model: geminiModel(), requestedById: userId });
  const reviewId = created.review.id;

  console.log(`\nReviewing debate ${debateId}...\n`);

  try {
    const result = await runReview(reviewId, text);
    if (!result) {
      console.error("The review was not QUEUED anymore, nothing to run.");
      process.exit(1);
    }
    console.log(formatReview(result));
  } catch (err) {
    if (err instanceof PipelineError) {
      console.error(`\nPipeline failed at step "${err.step}": ${err.message}`);
    } else {
      console.error("\nPipeline failed:", err instanceof Error ? err.message : String(err));
    }
    process.exit(1);
  }
}

main();
