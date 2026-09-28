import { finishReviewComplete, finishReviewFailed, recordAiCall, startReview } from "@varroom/db";
import type { FinishedClaim, FinishedEvidence } from "@varroom/db";
import { PipelineError, ReviewStoppedError } from "./types.ts";
import type { AiCallRecord, ClaimResult } from "./types.ts";
import { runPipeline } from "./pipeline.ts";
import type { EvidenceEntry, PipelineOptions, PipelineOutput } from "./pipeline.ts";
import { buildSummary } from "./summary.ts";

// the agent pipeline's entry point. the caller (api or cli) creates the review row,
// then runReview runs the agents on it and saves the result

// what runReview hands back once the pipeline finished
export type ReviewRunResult = {
  reviewId: string;
  saved: boolean; // false = the review had already ended (e.g. timed out), nothing was written
  claims: ClaimResult[];
  evidence: EvidenceEntry[];
  score: number | null;
  decision: "CONFIRMED" | "OVERTURNED" | "INCONCLUSIVE";
  summary: string;
};

// the gemini model reviews run on, also stored on the review row
export { geminiModel } from "./types.ts";

// turns any error into the "<kind>: <detail>" text saved in failure_reason
export function failureReasonFor(err: unknown): string {
  if (err instanceof PipelineError) {
    return `${err.step}: ${err.message}`;
  }
  if (err instanceof Error) {
    return `internal: ${err.message}`;
  }
  return `internal: ${String(err)}`;
}

// runs a QUEUED review: marks it RUNNING, runs moderator -> search -> fact checker,
// then saves claims, evidence and score in one go. returns null when the review
// wasn't QUEUED anymore (already ended or deleted). on a pipeline error the review
// is marked FAILED and the error is thrown again
export async function runReview(reviewId: string, text: string, options: PipelineOptions = {}): Promise<ReviewRunResult | null> {
  const started = await startReview(reviewId);
  if (!started) {
    return null;
  }

  // 1. run the agents, saving every gemini attempt as it ends
  // the review id also becomes the ADK session id, so tracing groups this review's spans.
  // reviewEnded turns true once a saved call shows the review already ended (timed out,
  // or deleted with its debate). from then on the pipeline starts no new gemini attempt
  let reviewEnded = false;
  const pipelineOptions: PipelineOptions = {
    ...options,
    reviewId: reviewId,
    onAiCall: async (record) => {
      const stillLive = await saveAiCall(reviewId, record);
      if (!stillLive) {
        reviewEnded = true;
      }
      if (options.onAiCall) {
        await options.onAiCall(record);
      }
    },
    shouldStop: () => {
      if (reviewEnded) {
        return true;
      }
      // the caller may know first, e.g. the api runner's timeout
      if (options.shouldStop) {
        return options.shouldStop();
      }
      return false;
    },
  };

  let output: PipelineOutput;
  try {
    output = await runPipeline(text, pipelineOptions);
  } catch (err) {
    // a stopped review was already ended by whatever stopped it, so keep its reason
    if (!(err instanceof ReviewStoppedError)) {
      await markFailed(reviewId, failureReasonFor(err));
    }
    throw err;
  }

  // 2. save everything. finishReviewComplete skips the write if the review already ended
  const summary = buildSummary(output.claims);
  let saved = false;
  try {
    saved = await finishReviewComplete(reviewId, {
      score: output.score,
      decision: output.decision,
      summary: summary,
      evidence: toFinishedEvidence(output.evidence),
      claims: toFinishedClaims(output.claims),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(reviewId, `persist: ${message}`);
    throw new PipelineError(`Saving the review failed: ${message}`, "persist");
  }

  return {
    reviewId: reviewId,
    saved: saved,
    claims: output.claims,
    evidence: output.evidence,
    score: output.score,
    decision: output.decision,
    summary: summary,
  };
}

// helpers

// saves one gemini attempt and returns whether the review is still live.
// a failed save is only logged: losing a trace row must never fail the review
// itself, so the review carries on (true) when we can't tell
async function saveAiCall(reviewId: string, record: AiCallRecord): Promise<boolean> {
  try {
    return await recordAiCall(reviewId, record);
  } catch (err) {
    console.error(`review ${reviewId}: could not record a ${record.step} call:`, err);
    return true;
  }
}

// marks the review FAILED but never lets that write hide the original error
async function markFailed(reviewId: string, reason: string): Promise<void> {
  try {
    await finishReviewFailed(reviewId, reason);
  } catch (err) {
    console.error(`could not mark review ${reviewId} as failed:`, err);
  }
}

function toFinishedEvidence(entries: EvidenceEntry[]): FinishedEvidence[] {
  const rows: FinishedEvidence[] = [];
  for (const entry of entries) {
    rows.push({
      label: entry.label,
      toolName: entry.toolName,
      args: entry.args,
      result: entry.result,
      kind: entry.kind,
      sourceUrl: entry.sourceUrl,
      sourceTitle: entry.sourceTitle,
      publishedAt: entry.publishedAt,
      error: entry.error,
    });
  }
  return rows;
}

function toFinishedClaims(claims: ClaimResult[]): FinishedClaim[] {
  const rows: FinishedClaim[] = [];
  for (const claim of claims) {
    // untestable claims are never judged, so they stay PENDING in the db
    let verdict: "PENDING" | "VERIFIED" | "PARTIALLY_TRUE" | "REFUTED" | "INSUFFICIENT_DATA" = "PENDING";
    if (claim.verdict !== "UNTESTABLE") {
      verdict = claim.verdict;
    }

    rows.push({
      order: claim.order,
      claimText: claim.claimText,
      type: claim.type,
      entities: claim.entities,
      verdict: verdict,
      reasoning: claim.reasoning,
      confidence: claim.confidence,
      citedLabels: claim.citedLabels,
    });
  }
  return rows;
}

export { PipelineError, ReviewStoppedError } from "./types.ts";
export { setupTracing } from "./telemetry.ts";
export type { AiCallFn, PipelineOptions, RunAgentFn, SearchWebFn } from "./pipeline.ts";
export type { AgentReply, AiCallRecord, SearchReply, TokenUsage, WebSource } from "./types.ts";
