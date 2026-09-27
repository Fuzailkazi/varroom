import { z } from "zod";

// review api: start a review, watch it live over sse, load the verdict

// rules shared by the api and the web app
export const REVIEW_DAILY_LIMIT = 3; // reviews one fan can start per rolling 24h
export const REVIEW_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const REVIEW_TIMEOUT_MS = 3 * 60 * 1000; // a review running longer than this is failed

export const ReviewStatus = z.enum(["QUEUED", "RUNNING", "COMPLETE", "FAILED"]);
export const ReviewDecision = z.enum(["CONFIRMED", "OVERTURNED", "INCONCLUSIVE"]);

// the only failure reasons the public sees. raw error text stays in the db and logs
export const FailureCategory = z.enum(["timeout", "ai_service", "restart", "internal"]);

export const ReviewFailure = z.object({
  category: FailureCategory,
  message: z.string(),
});

// post /api/debates/:id/reviews -> 202 (new) or 200 (already exists)
export const StartReviewResponse = z.object({
  review: z.object({
    id: z.string(),
    debateId: z.string(),
    status: ReviewStatus,
    createdAt: z.iso.datetime(),
  }),
});

export const ReviewClaim = z.object({
  order: z.number().int(),
  claimText: z.string(),
  type: z.enum(["POSITIONAL_ROLE", "UNTESTABLE"]),
  entities: z.object({
    player: z.string(),
    positionA: z.string(),
    positionB: z.string().optional(),
  }),
  verdict: z.enum(["PENDING", "VERIFIED", "PARTIALLY_TRUE", "REFUTED", "INSUFFICIENT_DATA", "UNTESTABLE"]),
  reasoning: z.string().nullable(),
  confidence: z.number().nullable(),
  citedLabels: z.array(z.string()),
});

export const ReviewEvidence = z.object({
  label: z.string(), // "E1", "E2", ...
  claimOrder: z.number().int(), // the claim this source was gathered for
  kind: z.string(),
  sourceUrl: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  status: z.enum(["ok", "no_sources", "search_failed"]),
});

// get /api/reviews/:id
export const ReviewResponse = z.object({
  review: z.object({
    id: z.string(),
    debateId: z.string(),
    status: ReviewStatus,
    decision: ReviewDecision.nullable(),
    credibilityScore: z.number().int().nullable(),
    summary: z.string().nullable(),
    failure: ReviewFailure.nullable(), // only set when FAILED
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    claims: z.array(ReviewClaim),
    evidence: z.array(ReviewEvidence),
  }),
});

// sse events on get /api/reviews/:id/events

// sent when the moderator has split the debate into claims
export const ClaimsExtractedEvent = z.object({
  reviewId: z.string(),
  claims: z.array(
    z.object({
      order: z.number().int(),
      claimText: z.string(),
      type: z.enum(["POSITIONAL_ROLE", "UNTESTABLE"]),
    }),
  ),
});

// last event on the stream when the review finished
export const ReviewCompletedEvent = z.object({
  reviewId: z.string(),
  status: z.literal("COMPLETE"),
  decision: ReviewDecision,
  credibilityScore: z.number().int().nullable(),
  summary: z.string().nullable(),
});

// last event on the stream when the review failed
export const ReviewFailedEvent = z.object({
  reviewId: z.string(),
  status: z.literal("FAILED"),
  failure: ReviewFailure,
});

export type ReviewStatus = z.infer<typeof ReviewStatus>;
export type ReviewDecision = z.infer<typeof ReviewDecision>;
export type FailureCategory = z.infer<typeof FailureCategory>;
export type ReviewFailure = z.infer<typeof ReviewFailure>;
export type StartReviewResponse = z.infer<typeof StartReviewResponse>;
export type ReviewClaim = z.infer<typeof ReviewClaim>;
export type ReviewEvidence = z.infer<typeof ReviewEvidence>;
export type ReviewResponse = z.infer<typeof ReviewResponse>;
export type ClaimsExtractedEvent = z.infer<typeof ClaimsExtractedEvent>;
export type ReviewCompletedEvent = z.infer<typeof ReviewCompletedEvent>;
export type ReviewFailedEvent = z.infer<typeof ReviewFailedEvent>;
