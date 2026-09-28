import { prisma } from "./client.ts";

// db access for ai_calls: one row per gemini attempt of a review, retries included.
// the trace shows these rows and the daily budget counts them

export type AiCallStepValue = "MODERATOR" | "SEARCH" | "FACT_CHECKER";
export type AiCallStatusValue = "OK" | "ERROR";

// one finished gemini attempt, as the agents pipeline reports it
export type NewAiCall = {
  step: AiCallStepValue;
  attempt: number;
  claimOrder: number | null;
  model: string;
  status: AiCallStatusValue;
  error: string | null;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number } | null;
  durationMs: number;
  startedAt: Date;
};

// helpers

// postgres foreign key violation: here it means the review row is gone (its debate was deleted)
function isForeignKeyViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === "P2003";
}

// the ai_calls columns of one attempt, for the given review (or null)
function toRowData(reviewId: string | null, call: NewAiCall) {
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;
  if (call.usage !== null) {
    inputTokens = call.usage.inputTokens;
    outputTokens = call.usage.outputTokens;
    thinkingTokens = call.usage.thinkingTokens;
  }

  return {
    reviewId: reviewId,
    step: call.step,
    attempt: call.attempt,
    claimOrder: call.claimOrder,
    model: call.model,
    status: call.status,
    error: call.error,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    thinkingTokens: thinkingTokens,
    // the column is a whole number of milliseconds
    durationMs: Math.round(call.durationMs),
    startedAt: call.startedAt,
  };
}

// recording a call

// saves one attempt and adds its tokens (and 1 call) to the review's totals, in one
// transaction so the totals always match the rows. if the review was deleted meanwhile,
// the row is saved with no review so it still counts toward today's budget.
// returns true while the review is still QUEUED or RUNNING. false means it already
// ended (timed out, failed) or is gone, so the pipeline should start no more calls
export async function recordAiCall(reviewId: string, call: NewAiCall): Promise<boolean> {
  const data = toRowData(reviewId, call);

  try {
    const [, review] = await prisma.$transaction([
      prisma.aiCall.create({ data: data }),
      prisma.review.update({
        where: { id: reviewId },
        data: {
          inputTokens: { increment: data.inputTokens },
          outputTokens: { increment: data.outputTokens },
          thinkingTokens: { increment: data.thinkingTokens },
          aiCallCount: { increment: 1 },
        },
        select: { status: true },
      }),
    ]);
    return review.status === "QUEUED" || review.status === "RUNNING";
  } catch (err) {
    if (!isForeignKeyViolation(err)) {
      throw err;
    }
    // no review to add totals to, so just keep the call
    await prisma.aiCall.create({ data: toRowData(null, call) });
    return false;
  }
}

// cleaning up old calls

// deletes every call that started more than 48 hours ago and returns how many went.
// the per call detail is only for debugging recent reviews, the review totals stay as they are.
// the cutoff uses the database clock, the same clock the budget uses
export async function deleteOldAiCalls(): Promise<number> {
  const deleted = await prisma.$executeRaw`
    DELETE FROM ai_calls
    WHERE started_at < now() - interval '48 hours'
  `;
  return deleted;
}

// reading a review's trace

// one saved attempt, as the trace shows it
export type ReviewTraceCall = {
  step: AiCallStepValue;
  attempt: number;
  claimOrder: number | null;
  model: string;
  status: AiCallStatusValue;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  durationMs: number;
  startedAt: Date;
};

// a review's totals plus every call it made, for the trace cli and the admin endpoint
export type ReviewTrace = {
  id: string;
  debateId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  aiCallCount: number;
  // true when the review made calls but their rows are gone (cleaned up after 48 hours).
  // the totals above still count them
  callsDeleted: boolean;
  calls: ReviewTraceCall[];
};

// the review and its calls in time order, or null if the review doesn't exist.
// the id must be a uuid, callers check that first
export async function getReviewTrace(reviewId: string): Promise<ReviewTrace | null> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: {
      // two calls can start in the same millisecond, the id breaks the tie
      aiCalls: { orderBy: [{ startedAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!review) {
    return null;
  }

  const calls: ReviewTraceCall[] = [];
  for (const row of review.aiCalls) {
    calls.push({
      step: row.step,
      attempt: row.attempt,
      claimOrder: row.claimOrder,
      model: row.model,
      status: row.status,
      error: row.error,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      thinkingTokens: row.thinkingTokens,
      durationMs: row.durationMs,
      startedAt: row.startedAt,
    });
  }

  // the review counted calls, but none of their rows are left
  const callsDeleted = review.aiCallCount > 0 && calls.length === 0;

  return {
    id: review.id,
    debateId: review.debateId,
    status: review.status,
    createdAt: review.createdAt,
    startedAt: review.startedAt,
    completedAt: review.completedAt,
    inputTokens: review.inputTokens,
    outputTokens: review.outputTokens,
    thinkingTokens: review.thinkingTokens,
    aiCallCount: review.aiCallCount,
    callsDeleted: callsDeleted,
    calls: calls,
  };
}
