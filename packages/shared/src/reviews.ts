import { z } from "zod";

// review api: start a review, watch it live over sse, load the verdict

// rules shared by the api and the web app
export const DEFAULT_REVIEW_DAILY_LIMIT = 3; // reviews one fan can start per rolling 24h, unless REVIEW_DAILY_LIMIT says otherwise
export const DEFAULT_AI_DAILY_CALL_LIMIT = 100; // gemini calls per pacific day, unless AI_DAILY_CALL_LIMIT says otherwise
export const REVIEW_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const REVIEW_TIMEOUT_MS = 3 * 60 * 1000; // a review running longer than this is failed

// a review searches at most this many testable claims. later ones are left unchecked
export const MAX_SEARCHED_CLAIMS = 5;
// the most gemini calls one review can ever make:
// moderator 3 attempts + 5 searches x 2 attempts + fact checker 3 attempts
export const REVIEW_CALL_RESERVE = 16;

// the two usage limits, read from env vars. the api and the review cli both use
// readUsageLimits, so they can never parse the limits differently
export type UsageLimits = {
  aiDailyCallLimit: number; // AI_DAILY_CALL_LIMIT: gemini calls allowed per pacific day
  reviewDailyLimit: number; // REVIEW_DAILY_LIMIT: reviews one fan can start per rolling 24h
};

// one limit: the default when unset (or blank), else a positive whole number.
// anything else throws, so a typo stops the server instead of silently changing the limit
function readLimit(env: Record<string, string | undefined>, name: string, defaultValue: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  const text = raw.trim();
  const isWholeNumber = /^\d+$/.test(text);
  const value = Number(text);
  if (!isWholeNumber || value < 1 || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a positive whole number, got "${raw}".`);
  }
  return value;
}

export function readUsageLimits(env: Record<string, string | undefined>): UsageLimits {
  return {
    aiDailyCallLimit: readLimit(env, "AI_DAILY_CALL_LIMIT", DEFAULT_AI_DAILY_CALL_LIMIT),
    reviewDailyLimit: readLimit(env, "REVIEW_DAILY_LIMIT", DEFAULT_REVIEW_DAILY_LIMIT),
  };
}

// "12:00 AM PDT (07:00 UTC)". the budget always resets at pacific midnight,
// so we show pacific time first, plus utc for everyone else
function formatResetTime(resetsAt: Date): string {
  const pacific = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(resetsAt);
  const utc = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
  }).format(resetsAt);
  return `${pacific} (${utc} UTC)`;
}

// what the api and the cli say when the daily gemini budget is used up
export function dailyBudgetMessage(resetsAt: Date): string {
  return `VAR is resting for today. Reviews open again at ${formatResetTime(resetsAt)}.`;
}

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

// get /api/reviews/availability: can a new review start right now, and when the
// daily budget resets (next midnight pacific). never any call counts
export const AvailabilityResponse = z.object({
  open: z.boolean(),
  resetsAt: z.iso.datetime(),
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
export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>;
export type ReviewClaim = z.infer<typeof ReviewClaim>;
export type ReviewEvidence = z.infer<typeof ReviewEvidence>;
export type ReviewResponse = z.infer<typeof ReviewResponse>;
export type ClaimsExtractedEvent = z.infer<typeof ClaimsExtractedEvent>;
export type ReviewCompletedEvent = z.infer<typeof ReviewCompletedEvent>;
export type ReviewFailedEvent = z.infer<typeof ReviewFailedEvent>;
