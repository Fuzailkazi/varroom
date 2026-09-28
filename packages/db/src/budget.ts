import { prisma } from "./client.ts";
import type { Prisma } from "./generated/prisma/client.ts";
import { REVIEW_CALL_RESERVE, REVIEW_LIMIT_WINDOW_MS, REVIEW_TIMEOUT_MS } from "@varroom/shared";
import { findLiveReview } from "./reviews.ts";
import type { ReviewSummaryRow } from "./reviews.ts";

// the daily gemini budget, and the one place new reviews are created.
// the budget counts ai_calls rows, resets at midnight pacific (when gemini's free
// quota resets), and only lets a review start if its worst case still fits today

// any fixed number works, it only has to be the same for every review start.
// postgres advisory locks are keyed by a bigint, and nothing else in the app uses this one
const REVIEW_START_LOCK_KEY = 900_918_001;

// a running review older than this is stuck (the 3 minute timeout plus a minute
// of margin), so it holds no reserve
const RESERVE_WINDOW_SECONDS = (REVIEW_TIMEOUT_MS + 60 * 1000) / 1000;

// the start is a few quick queries, but it may wait in line behind other starts for the lock
const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 15000 };

export type BudgetStatus = {
  limit: number; // gemini calls allowed today
  used: number; // calls made since the last midnight pacific
  reserved: number; // calls that running reviews may still make
  left: number; // limit - used - reserved, never below 0
  open: boolean; // true when one more review's worst case still fits
  resetsAt: Date; // the next midnight pacific
};

// helpers

// postgres unique violation, e.g. a second live review for the same debate
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === "P2002";
}

type BudgetRow = {
  resets_at: Date;
  used: bigint;
  reserved: bigint;
};

// reads today's numbers in one query. the day boundaries are computed by postgres
// in the America/Los_Angeles zone, so daylight saving is handled for us.
// db is the prisma client, or the start transaction
async function readBudget(db: Prisma.TransactionClient, limit: number): Promise<BudgetStatus> {
  // day_start: the last midnight pacific. next_day_start: the one after it.
  // reviews.created_at has no time zone (prisma saves it in utc), so compare it with utc now
  const rows = await db.$queryRaw<BudgetRow[]>`
    WITH day AS (
      SELECT
        date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles' AS day_start,
        (date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') + interval '1 day') AT TIME ZONE 'America/Los_Angeles' AS next_day_start
    )
    SELECT
      day.next_day_start AS resets_at,
      (SELECT COUNT(*) FROM ai_calls WHERE ai_calls.started_at >= day.day_start) AS used,
      (
        SELECT COALESCE(SUM(GREATEST(0, ${REVIEW_CALL_RESERVE}::int - (
          SELECT COUNT(*) FROM ai_calls WHERE ai_calls.review_id = reviews.id
        ))), 0)
        FROM reviews
        WHERE reviews.status IN ('QUEUED', 'RUNNING')
          AND reviews.created_at > (now() AT TIME ZONE 'UTC') - make_interval(secs => ${RESERVE_WINDOW_SECONDS}::int)
      ) AS reserved
    FROM day
  `;

  const row = rows[0]!;
  const used = Number(row.used);
  const reserved = Number(row.reserved);

  let left = limit - used - reserved;
  if (left < 0) {
    left = 0;
  }

  // a new review may make up to REVIEW_CALL_RESERVE calls, all of which must fit
  const open = used + reserved + REVIEW_CALL_RESERVE <= limit;

  return {
    limit: limit,
    used: used,
    reserved: reserved,
    left: left,
    open: open,
    resetsAt: row.resets_at,
  };
}

// the fan cap: a fan may start `limit` reviews per rolling 24h, failed ones don't count.
// returns when the next slot frees up, or null when the fan still has a slot
async function fanCapRetryAt(db: Prisma.TransactionClient, userId: string, limit: number): Promise<Date | null> {
  const windowStart = new Date(Date.now() - REVIEW_LIMIT_WINDOW_MS);
  const rows = await db.review.findMany({
    where: {
      requestedById: userId,
      createdAt: { gt: windowStart },
      status: { not: "FAILED" },
    },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  if (rows.length < limit) {
    return null;
  }
  // the fan gets a slot back once fewer than `limit` reviews are left in the window.
  // usually that's when the oldest one turns 24h old, but a fan can have more than
  // `limit` (e.g. after REVIEW_DAILY_LIMIT was lowered), and then more have to age out first
  const freesTheSlot = rows[rows.length - limit]!.createdAt;
  return new Date(freesTheSlot.getTime() + REVIEW_LIMIT_WINDOW_MS);
}

// reading the budget

// today's budget, for the availability endpoint and the trace cli
export async function getBudgetStatus(limit: number): Promise<BudgetStatus> {
  return readBudget(prisma, limit);
}

// starting a review

export type StartReviewInput = {
  debateId: string;
  model: string;
  requestedById: string | null; // null when nobody signed in asked, e.g. the cli
  fanDailyLimit: number | null; // null skips the fan cap (admins and the cli)
  aiDailyCallLimit: number;
};

// what happened to the start:
//   created  a new QUEUED review
//   exists   the debate already has a live or finished review, returned instead
//   fan_cap  this fan used up their reviews for now, retryAt says when a slot frees up
//   budget   today's gemini budget can't fit another review, it resets at resetsAt
export type StartReviewResult =
  | { outcome: "created"; review: ReviewSummaryRow }
  | { outcome: "exists"; review: ReviewSummaryRow }
  | { outcome: "fan_cap"; retryAt: Date }
  | { outcome: "budget"; resetsAt: Date; budget: BudgetStatus };

// the checks and the insert, all inside the start transaction
async function startInTransaction(tx: Prisma.TransactionClient, input: StartReviewInput): Promise<StartReviewResult> {
  // 1. wait for our turn. every start takes this same lock, so two starts arriving
  // together run one after the other and can't both take the last slot.
  // it's the transaction lock (xact): it's released when the transaction ends, and it
  // stays on this transaction's connection even behind neon's pooler
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REVIEW_START_LOCK_KEY}::bigint)`;

  // 2. someone may have started this debate's review while we waited
  const live = await findLiveReview(input.debateId, tx);
  if (live) {
    return { outcome: "exists", review: live };
  }

  // 3. the fan cap, unless this start skips it
  if (input.fanDailyLimit !== null && input.requestedById !== null) {
    const retryAt = await fanCapRetryAt(tx, input.requestedById, input.fanDailyLimit);
    if (retryAt) {
      return { outcome: "fan_cap", retryAt: retryAt };
    }
  }

  // 4. the global budget. nobody skips it, admins included
  const budget = await readBudget(tx, input.aiDailyCallLimit);
  if (!budget.open) {
    return { outcome: "budget", resetsAt: budget.resetsAt, budget: budget };
  }

  // 5. there's room: create the QUEUED review. it now holds its reserve
  const review = await tx.review.create({
    data: {
      debateId: input.debateId,
      status: "QUEUED",
      model: input.model,
      requestedById: input.requestedById,
    },
    select: { id: true, debateId: true, status: true, createdAt: true },
  });
  return { outcome: "created", review: review };
}

// the only way to create a review (the api and the cli both use it). the fan cap,
// the budget and the insert run in one transaction behind one lock
export async function startReviewLocked(input: StartReviewInput): Promise<StartReviewResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      return startInTransaction(tx, input);
    }, TRANSACTION_OPTIONS);
  } catch (err) {
    // a review made outside the lock (only tests do that) can still win the unique
    // index race. the failed insert ends the transaction, so look up the winner after it
    if (!isUniqueViolation(err)) {
      throw err;
    }
    const existing = await findLiveReview(input.debateId);
    if (!existing) {
      // it failed between the insert and this read. rare, let the caller retry
      throw err;
    }
    return { outcome: "exists", review: existing };
  }
}
