import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { getReviewTrace } from "@varroom/db";
import type { ReviewTrace } from "@varroom/db";
import { AdminReviewTraceResponse } from "@varroom/shared";
import type { AdminTraceCall } from "@varroom/shared";
import { requireRole } from "../auth/guards.ts";
import { sendError } from "../errors.ts";

// admin api, mounted at /api/admin. every route here is for signed in admins only

const Uuid = z.uuid();

export function createAdminRouter() {
  const router = Router();
  // the guard runs before we look at the id, so a non admin never learns whether a review exists
  router.get("/reviews/:id/trace", requireRole("ADMIN"), reviewTraceHandler);
  return router;
}

// helpers

// the trace rows as json: dates become iso strings, raw errors stay in (admins only)
function toTraceResponse(trace: ReviewTrace): AdminReviewTraceResponse {
  const calls: AdminTraceCall[] = [];
  for (const call of trace.calls) {
    calls.push({
      step: call.step,
      attempt: call.attempt,
      claimOrder: call.claimOrder,
      model: call.model,
      status: call.status,
      error: call.error,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      thinkingTokens: call.thinkingTokens,
      durationMs: call.durationMs,
      startedAt: call.startedAt.toISOString(),
    });
  }

  return AdminReviewTraceResponse.parse({
    review: {
      id: trace.id,
      debateId: trace.debateId,
      status: trace.status,
      createdAt: trace.createdAt.toISOString(),
      startedAt: trace.startedAt ? trace.startedAt.toISOString() : null,
      completedAt: trace.completedAt ? trace.completedAt.toISOString() : null,
      inputTokens: trace.inputTokens,
      outputTokens: trace.outputTokens,
      thinkingTokens: trace.thinkingTokens,
      aiCallCount: trace.aiCallCount,
      callsDeleted: trace.callsDeleted,
    },
    calls: calls,
  });
}

// get /api/admin/reviews/:id/trace: a review's totals and every gemini call it made

async function reviewTraceHandler(req: Request, res: Response) {
  const reviewId = String(req.params.id);

  // a malformed id can't be a review, and postgres would reject it anyway
  if (!Uuid.safeParse(reviewId).success) {
    sendError(res, 404, "NOT_FOUND", "No such review.");
    return;
  }

  const trace = await getReviewTrace(reviewId);
  if (!trace) {
    sendError(res, 404, "NOT_FOUND", "No such review.");
    return;
  }

  res.json(toTraceResponse(trace));
}
