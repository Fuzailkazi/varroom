import { prisma } from "./client.ts";
import type { Prisma } from "./generated/prisma/client.ts";

// db access for var reviews, their claims, evidence and progress events.
// the agents and the api go through these, never prisma directly

// finishing a review writes several rows in one go, over a few neon round trips
const TRANSACTION_OPTIONS = { maxWait: 5000, timeout: 20000 };

// a review is still live while it's QUEUED or RUNNING. anything else is final
const LIVE_STATUSES: ("QUEUED" | "RUNNING")[] = ["QUEUED", "RUNNING"];

export type ReviewStatusValue = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";
export type DecisionValue = "CONFIRMED" | "OVERTURNED" | "INCONCLUSIVE";

// the few review fields the start endpoint returns
export type ReviewSummaryRow = {
  id: string;
  debateId: string;
  status: ReviewStatusValue;
  createdAt: Date;
};

// starting a review (the locked start itself is in budget.ts)

// the one review of a debate that isn't FAILED, or null. the unique index allows at most one.
// db is the prisma client, or a transaction when the caller is inside one
export async function findLiveReview(
  debateId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<ReviewSummaryRow | null> {
  const review = await db.review.findFirst({
    where: { debateId: debateId, status: { not: "FAILED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, debateId: true, status: true, createdAt: true },
  });
  return review;
}

// the text the agents review: title, a blank line, then the thesis. null if the debate is gone
export async function getDebateText(debateId: string): Promise<string | null> {
  const debate = await prisma.debate.findUnique({
    where: { id: debateId },
    select: { title: true, thesis: true },
  });
  if (!debate) {
    return null;
  }
  return `${debate.title}\n\n${debate.thesis}`;
}

// running a review

// QUEUED -> RUNNING. false if the review isn't QUEUED anymore (or was deleted)
export async function startReview(reviewId: string): Promise<boolean> {
  const updated = await prisma.review.updateMany({
    where: { id: reviewId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  return updated.count === 1;
}

// saves one progress event and returns its id (a string, it's a bigint in the db)
export async function addReviewEvent(reviewId: string, seq: number, type: string, payload: unknown): Promise<string> {
  const event = await prisma.reviewEvent.create({
    data: {
      reviewId: reviewId,
      seq: seq,
      type: type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: payload as any,
    },
    select: { id: true },
  });
  return event.id.toString();
}

export type ReviewEventRow = {
  id: string;
  type: string;
  payload: unknown;
};

// saved events of a review with an id above afterId (all of them when afterId is null), oldest first
export async function listReviewEventsAfter(reviewId: string, afterId: bigint | null): Promise<ReviewEventRow[]> {
  let where: Prisma.ReviewEventWhereInput = { reviewId: reviewId };
  if (afterId !== null) {
    where = { reviewId: reviewId, id: { gt: afterId } };
  }

  const rows = await prisma.reviewEvent.findMany({
    where: where,
    orderBy: { id: "asc" },
    select: { id: true, type: true, payload: true },
  });

  const events: ReviewEventRow[] = [];
  for (const row of rows) {
    events.push({ id: row.id.toString(), type: row.type, payload: row.payload });
  }
  return events;
}

// finishing a review

export type FinishedEvidence = {
  label: string;
  toolName: string;
  args: unknown;
  result: unknown;
  kind: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  publishedAt: Date | null;
  error: string | null;
};

export type FinishedClaim = {
  order: number;
  claimText: string;
  type: "POSITIONAL_ROLE" | "UNTESTABLE";
  entities: unknown;
  // PENDING for untestable claims, they're never judged
  verdict: "PENDING" | "VERIFIED" | "PARTIALLY_TRUE" | "REFUTED" | "INSUFFICIENT_DATA";
  reasoning: string | null;
  confidence: number | null;
  citedLabels: string[];
};

export type FinishedReview = {
  score: number | null;
  decision: DecisionValue;
  summary: string;
  // no token counts here: recordAiCall adds them up call by call
  evidence: FinishedEvidence[];
  claims: FinishedClaim[];
};

// saves a finished review in one transaction: marks it COMPLETE, writes the evidence,
// claims and citation links, drops its progress events, and copies the score onto the debate.
// returns false (and writes nothing) if the review already ended, e.g. it timed out
export async function finishReviewComplete(reviewId: string, finished: FinishedReview): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // 1. only a live review can be completed. this is what drops a late result
    const updated = await tx.review.updateMany({
      where: { id: reviewId, status: { in: LIVE_STATUSES } },
      data: {
        status: "COMPLETE",
        credibilityScore: finished.score,
        decision: finished.decision,
        summary: finished.summary,
        completedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      return false;
    }

    // 2. evidence rows, remembering each label's new row id for the links
    const evidenceIdByLabel = new Map<string, string>();
    for (const entry of finished.evidence) {
      const row = await tx.evidence.create({
        data: {
          reviewId: reviewId,
          label: entry.label,
          toolName: entry.toolName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          args: entry.args as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result: entry.result as any,
          kind: entry.kind,
          sourceUrl: entry.sourceUrl,
          sourceTitle: entry.sourceTitle,
          publishedAt: entry.publishedAt,
          error: entry.error,
        },
        select: { id: true },
      });
      evidenceIdByLabel.set(entry.label, row.id);
    }

    // 3. claims plus the evidence each one cites
    for (const claim of finished.claims) {
      const row = await tx.claim.create({
        data: {
          reviewId: reviewId,
          order: claim.order,
          claimText: claim.claimText,
          type: claim.type,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          entities: claim.entities as any,
          verdict: claim.verdict,
          reasoning: claim.reasoning,
          confidence: claim.confidence,
        },
        select: { id: true },
      });

      for (const label of claim.citedLabels) {
        const evidenceId = evidenceIdByLabel.get(label);
        if (evidenceId) {
          await tx.claimEvidence.create({ data: { claimId: row.id, evidenceId: evidenceId } });
        }
      }
    }

    // 4. progress events are only for the live stream, the saved rows cover the rest
    await tx.reviewEvent.deleteMany({ where: { reviewId: reviewId } });

    // 5. the board shows the newest completed score. skip when there's no score
    if (finished.score !== null) {
      const review = await tx.review.findUnique({ where: { id: reviewId }, select: { debateId: true } });
      if (review) {
        await tx.debate.update({ where: { id: review.debateId }, data: { credibilityScore: finished.score } });
      }
    }

    return true;
  }, TRANSACTION_OPTIONS);
}

// marks a live review FAILED and drops its progress events, in one transaction.
// reason is "<kind>: <detail>", e.g. "timeout: ...". false if it had already ended
export async function finishReviewFailed(reviewId: string, reason: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.review.updateMany({
      where: { id: reviewId, status: { in: LIVE_STATUSES } },
      data: { status: "FAILED", failureReason: reason, completedAt: new Date() },
    });
    if (updated.count === 0) {
      return false;
    }
    await tx.reviewEvent.deleteMany({ where: { reviewId: reviewId } });
    return true;
  }, TRANSACTION_OPTIONS);
}

// on api start: any review still QUEUED or RUNNING was cut off by the restart.
// fails them all and returns their ids
export async function failInterruptedReviews(reason: string): Promise<string[]> {
  const stuck = await prisma.review.findMany({
    where: { status: { in: LIVE_STATUSES } },
    select: { id: true },
  });

  const ids: string[] = [];
  for (const review of stuck) {
    const failed = await finishReviewFailed(review.id, reason);
    if (failed) {
      ids.push(review.id);
    }
  }
  return ids;
}

// reading a review

// status and result fields, enough for the stream's final event
export type ReviewStateRow = {
  id: string;
  debateId: string;
  status: ReviewStatusValue;
  decision: DecisionValue | null;
  credibilityScore: number | null;
  summary: string | null;
  failureReason: string | null;
};

export async function getReviewState(reviewId: string): Promise<ReviewStateRow | null> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      debateId: true,
      status: true,
      decision: true,
      credibilityScore: true,
      summary: true,
      failureReason: true,
    },
  });
  return review;
}

export type ReviewDetailClaim = {
  order: number;
  claimText: string;
  type: "POSITIONAL_ROLE" | "UNTESTABLE" | "COMPARISON" | "TEAM_TACTIC" | "TRANSFER_FIT";
  entities: unknown;
  verdict: "PENDING" | "VERIFIED" | "PARTIALLY_TRUE" | "REFUTED" | "INSUFFICIENT_DATA";
  reasoning: string | null;
  confidence: number | null;
  citedLabels: string[];
};

export type ReviewDetailEvidence = {
  label: string;
  args: unknown;
  kind: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  publishedAt: Date | null;
  error: string | null;
};

export type ReviewDetailRow = {
  id: string;
  debateId: string;
  status: ReviewStatusValue;
  decision: DecisionValue | null;
  credibilityScore: number | null;
  summary: string | null;
  failureReason: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  claims: ReviewDetailClaim[];
  evidence: ReviewDetailEvidence[];
};

// a whole review with its claims, cited labels and evidence. null if it doesn't exist
export async function getReviewDetail(reviewId: string): Promise<ReviewDetailRow | null> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: {
      claims: {
        orderBy: { order: "asc" },
        include: { citations: { include: { evidence: { select: { label: true } } } } },
      },
      evidence: true,
    },
  });
  if (!review) {
    return null;
  }

  const claims: ReviewDetailClaim[] = [];
  for (const claim of review.claims) {
    const citedLabels: string[] = [];
    for (const citation of claim.citations) {
      citedLabels.push(citation.evidence.label);
    }
    citedLabels.sort(compareLabels);

    claims.push({
      order: claim.order,
      claimText: claim.claimText,
      type: claim.type,
      entities: claim.entities,
      verdict: claim.verdict,
      reasoning: claim.reasoning,
      confidence: claim.confidence,
      citedLabels: citedLabels,
    });
  }

  const evidence: ReviewDetailEvidence[] = [];
  for (const row of review.evidence) {
    evidence.push({
      label: row.label,
      args: row.args,
      kind: row.kind,
      sourceUrl: row.sourceUrl,
      sourceTitle: row.sourceTitle,
      publishedAt: row.publishedAt,
      error: row.error,
    });
  }
  evidence.sort((a, b) => compareLabels(a.label, b.label));

  return {
    id: review.id,
    debateId: review.debateId,
    status: review.status,
    decision: review.decision,
    credibilityScore: review.credibilityScore,
    summary: review.summary,
    failureReason: review.failureReason,
    createdAt: review.createdAt,
    startedAt: review.startedAt,
    completedAt: review.completedAt,
    claims: claims,
    evidence: evidence,
  };
}

// sorts "E2" before "E10" (plain string sort would put E10 first)
function compareLabels(a: string, b: string): number {
  const numberA = Number(a.slice(1));
  const numberB = Number(b.slice(1));
  return numberA - numberB;
}
