import { prisma } from "./client.ts";

// DB access for VAR reviews, claims, evidence, and claim_evidence.
// The agent pipeline goes through these, never prisma directly.

export type NewReview = {
  debateId: string;
  model: string;
};

// Creates a review row in QUEUED status and returns its id.
export async function createReview(input: NewReview): Promise<string> {
  const review = await prisma.review.create({
    data: {
      debateId: input.debateId,
      status: "QUEUED",
      model: input.model,
    },
    select: { id: true },
  });
  return review.id;
}

// Moves the review to RUNNING and records the start time.
export async function startReview(reviewId: string): Promise<void> {
  await prisma.review.update({
    where: { id: reviewId },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
}

// Marks the review COMPLETE and records the final score, decision, and token counts.
export async function completeReview(
  reviewId: string,
  score: number | null,
  decision: "CONFIRMED" | "OVERTURNED" | "INCONCLUSIVE",
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await prisma.review.update({
    where: { id: reviewId },
    data: {
      status: "COMPLETE",
      credibilityScore: score,
      decision: decision,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      completedAt: new Date(),
    },
  });

  // Mirror the score onto the debate so the board can show the latest result
  // without joining to reviews. Only update when this review actually produced a score.
  if (score !== null) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: { debateId: true },
    });
    if (review) {
      await prisma.debate.update({
        where: { id: review.debateId },
        data: { credibilityScore: score },
      });
    }
  }
}

// Marks the review FAILED and records why. Rows already written are kept.
export async function failReview(reviewId: string, reason: string): Promise<void> {
  await prisma.review.update({
    where: { id: reviewId },
    data: {
      status: "FAILED",
      failureReason: reason,
      completedAt: new Date(),
    },
  });
}

export type NewClaim = {
  reviewId: string;
  order: number;
  claimText: string;
  type: "POSITIONAL_ROLE" | "UNTESTABLE";
  entities: unknown;
};

// Creates a claim row in PENDING status and returns its id.
export async function createClaim(input: NewClaim): Promise<string> {
  const claim = await prisma.claim.create({
    data: {
      reviewId: input.reviewId,
      order: input.order,
      claimText: input.claimText,
      type: input.type,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entities: input.entities as any,
      verdict: "PENDING",
    },
    select: { id: true },
  });
  return claim.id;
}

// Updates the claim's verdict, reasoning, and confidence once the pipeline is done.
export async function updateClaim(
  claimId: string,
  verdict: "VERIFIED" | "PARTIALLY_TRUE" | "REFUTED" | "INSUFFICIENT_DATA",
  reasoning: string | null,
  confidence: number | null,
): Promise<void> {
  await prisma.claim.update({
    where: { id: claimId },
    data: {
      verdict: verdict,
      reasoning: reasoning,
      confidence: confidence,
    },
  });
}

export type NewEvidence = {
  reviewId: string;
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

// Creates an evidence row and returns its id.
export async function createEvidence(input: NewEvidence): Promise<string> {
  const evidence = await prisma.evidence.create({
    data: {
      reviewId: input.reviewId,
      label: input.label,
      toolName: input.toolName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: input.args as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result: input.result as any,
      kind: input.kind,
      sourceUrl: input.sourceUrl,
      sourceTitle: input.sourceTitle,
      publishedAt: input.publishedAt,
      error: input.error,
    },
    select: { id: true },
  });
  return evidence.id;
}

// Links a claim to the evidence it cited.
export async function createClaimEvidence(claimId: string, evidenceId: string): Promise<void> {
  await prisma.claimEvidence.create({
    data: { claimId, evidenceId },
  });
}
