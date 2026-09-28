// VAR Room trace CLI: shows what the agents did, from the terminal.
// Usage:
//   bun run trace <reviewId>   every gemini call of one review, with tokens and time
//   bun run trace              today's gemini budget
// Requires: DATABASE_URL (the root script loads .env).

import { z } from "zod";
import { getBudgetStatus, getReviewTrace } from "@varroom/db";
import type { BudgetStatus, ReviewTrace } from "@varroom/db";
import { readUsageLimits } from "@varroom/shared";
import type { UsageLimits } from "@varroom/shared";
import { formatBudget, formatTrace } from "./traceFormat.ts";

const Uuid = z.uuid();

function errorText(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// bun run trace <reviewId>
async function printTrace(reviewId: string) {
  // review ids are uuids. checking first also saves a database round trip for a typo
  if (!Uuid.safeParse(reviewId).success) {
    console.error(`"${reviewId}" is not a review id. Review ids look like 3f9a01bc-7d2e-4c1a-9b8e-5f6a7b8c9d0e.`);
    process.exit(1);
  }

  let trace: ReviewTrace | null;
  try {
    trace = await getReviewTrace(reviewId);
  } catch (err) {
    console.error("Could not read the review from the database:", errorText(err));
    process.exit(1);
  }

  if (!trace) {
    console.error(`No review with id ${reviewId}.`);
    process.exit(1);
  }

  console.log(formatTrace(trace));
}

// bun run trace
async function printBudget() {
  // the same limit the api and the review cli use, parsed the same way
  let limits: UsageLimits;
  try {
    limits = readUsageLimits(process.env);
  } catch (err) {
    console.error(errorText(err));
    process.exit(1);
  }

  let budget: BudgetStatus;
  try {
    budget = await getBudgetStatus(limits.aiDailyCallLimit);
  } catch (err) {
    console.error("Could not read today's budget from the database:", errorText(err));
    process.exit(1);
  }

  console.log(formatBudget(budget));
}

async function main() {
  const reviewId = process.argv[2];
  if (reviewId === undefined) {
    await printBudget();
  } else {
    await printTrace(reviewId);
  }
  // the database pool keeps open connections around, which would keep the process alive
  process.exit(0);
}

main();
