import { z } from "zod";
import { ReviewStatus } from "./reviews.ts";

// admin api. only signed in admins can call these, so raw errors are allowed here

// one gemini attempt of a review (a moderator, search or fact checker call, retries included)
export const AdminTraceCall = z.object({
  step: z.enum(["MODERATOR", "SEARCH", "FACT_CHECKER"]),
  attempt: z.number().int(), // 1, 2, 3
  claimOrder: z.number().int().nullable(), // searches only
  model: z.string(),
  status: z.enum(["OK", "ERROR"]),
  error: z.string().nullable(), // the raw error text, only on ERROR
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  thinkingTokens: z.number().int(),
  durationMs: z.number().int(),
  startedAt: z.iso.datetime(),
});

// get /api/admin/reviews/:id/trace
export const AdminReviewTraceResponse = z.object({
  review: z.object({
    id: z.string(),
    debateId: z.string(),
    status: ReviewStatus,
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    // totals of every call, kept even after the call rows are cleaned up
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    thinkingTokens: z.number().int(),
    aiCallCount: z.number().int(),
    callsDeleted: z.boolean(), // true when the calls below were cleaned up (after 48 hours)
  }),
  calls: z.array(AdminTraceCall),
});

export type AdminTraceCall = z.infer<typeof AdminTraceCall>;
export type AdminReviewTraceResponse = z.infer<typeof AdminReviewTraceResponse>;
