import type { ReviewDetailClaim, ReviewDetailEvidence, ReviewDetailRow, ReviewStateRow } from "@varroom/db";
import { ReviewResponse } from "@varroom/shared";
import type { FailureCategory, ReviewClaim, ReviewEvidence, ReviewFailure } from "@varroom/shared";

// turns review rows into what the public sees. raw failure text, the requester
// and raw search errors never leave this file

// must match the text the pipeline puts on an evidence row when a search found nothing
const NO_SOURCES_ERROR = "No sources returned";

// one message the runner sends to open streams
export type StreamMessage = {
  event: "claims_extracted" | "review_completed" | "review_failed";
  id: string | null; // saved event id (for Last-Event-ID), null for final events
  data: unknown;
};

// failure_reason is "<kind>: <detail>". the public only gets one of 4 categories
export function publicFailure(failureReason: string | null): ReviewFailure {
  let kind = "";
  if (failureReason) {
    const colon = failureReason.indexOf(":");
    if (colon > 0) {
      kind = failureReason.slice(0, colon);
    }
  }

  let category: FailureCategory = "internal";
  if (kind === "moderator" || kind === "fact_checker" || kind === "search") {
    category = "ai_service";
  } else if (kind === "timeout") {
    category = "timeout";
  } else if (kind === "restart") {
    category = "restart";
  }

  return { category: category, message: failureMessage(category) };
}

function failureMessage(category: FailureCategory): string {
  if (category === "timeout") {
    return "The check timed out.";
  }
  if (category === "ai_service") {
    return "The AI service had a problem.";
  }
  if (category === "restart") {
    return "The server restarted during the check.";
  }
  return "Something went wrong on our side.";
}

// the last event of a stream, built from the saved review. null while it's still running
export function finalEventFromState(state: ReviewStateRow): StreamMessage | null {
  if (state.status === "COMPLETE") {
    let decision = state.decision;
    if (!decision) {
      decision = "INCONCLUSIVE"; // never happens, complete reviews always get one
    }
    return {
      event: "review_completed",
      id: null,
      data: {
        reviewId: state.id,
        status: "COMPLETE",
        decision: decision,
        credibilityScore: state.credibilityScore,
        summary: state.summary,
      },
    };
  }
  if (state.status === "FAILED") {
    return failedEvent(state.id, publicFailure(state.failureReason));
  }
  return null;
}

export function failedEvent(reviewId: string, failure: ReviewFailure): StreamMessage {
  return {
    event: "review_failed",
    id: null,
    data: { reviewId: reviewId, status: "FAILED", failure: failure },
  };
}

// get /api/reviews/:id body
export function toReviewResponse(row: ReviewDetailRow): ReviewResponse {
  let failure: ReviewFailure | null = null;
  if (row.status === "FAILED") {
    failure = publicFailure(row.failureReason);
  }

  const claims: ReviewClaim[] = [];
  for (const claim of row.claims) {
    claims.push(toClaim(claim));
  }

  const evidence: ReviewEvidence[] = [];
  for (const entry of row.evidence) {
    evidence.push(toEvidence(entry));
  }

  return ReviewResponse.parse({
    review: {
      id: row.id,
      debateId: row.debateId,
      status: row.status,
      decision: row.decision,
      credibilityScore: row.credibilityScore,
      summary: row.summary,
      failure: failure,
      createdAt: row.createdAt.toISOString(),
      startedAt: toIso(row.startedAt),
      completedAt: toIso(row.completedAt),
      claims: claims,
      evidence: evidence,
    },
  });
}

// helpers

function toIso(date: Date | null): string | null {
  if (!date) {
    return null;
  }
  return date.toISOString();
}

// the verdicts and entities the api shows for a claim
type PublicVerdict = "PENDING" | "VERIFIED" | "PARTIALLY_TRUE" | "REFUTED" | "INSUFFICIENT_DATA" | "UNTESTABLE";
type PublicEntities = { player: string; positionA: string; positionB?: string };

function toClaim(claim: ReviewDetailClaim): ReviewClaim {
  // untestable claims stay PENDING in the db, show them as UNTESTABLE
  let verdict: PublicVerdict = claim.verdict;
  if (claim.type === "UNTESTABLE") {
    verdict = "UNTESTABLE";
  }

  let type: "POSITIONAL_ROLE" | "UNTESTABLE" = "UNTESTABLE";
  if (claim.type === "POSITIONAL_ROLE") {
    type = "POSITIONAL_ROLE";
  }

  return {
    order: claim.order,
    claimText: claim.claimText,
    type: type,
    entities: readEntities(claim.entities),
    verdict: verdict,
    reasoning: claim.reasoning,
    confidence: claim.confidence,
    citedLabels: claim.citedLabels,
  };
}

// entities is json in the db. old rows can be {}, so fall back to empty strings
function readEntities(value: unknown): PublicEntities {
  const entities: PublicEntities = { player: "", positionA: "" };
  if (typeof value !== "object" || value === null) {
    return entities;
  }
  const raw = value as { player?: unknown; positionA?: unknown; positionB?: unknown };
  if (typeof raw.player === "string") {
    entities.player = raw.player;
  }
  if (typeof raw.positionA === "string") {
    entities.positionA = raw.positionA;
  }
  if (typeof raw.positionB === "string") {
    entities.positionB = raw.positionB;
  }
  return entities;
}

function toEvidence(entry: ReviewDetailEvidence): ReviewEvidence {
  let status: "ok" | "no_sources" | "search_failed" = "ok";
  if (entry.error === NO_SOURCES_ERROR) {
    status = "no_sources";
  } else if (entry.error !== null) {
    status = "search_failed";
  }

  // args is {claimOrder, query} json, written by our own search loop
  let claimOrder = 0;
  if (typeof entry.args === "object" && entry.args !== null) {
    const raw = entry.args as { claimOrder?: unknown };
    if (typeof raw.claimOrder === "number") {
      claimOrder = raw.claimOrder;
    }
  }

  return {
    label: entry.label,
    claimOrder: claimOrder,
    kind: entry.kind,
    sourceUrl: entry.sourceUrl,
    sourceTitle: entry.sourceTitle,
    publishedAt: toIso(entry.publishedAt),
    status: status,
  };
}
