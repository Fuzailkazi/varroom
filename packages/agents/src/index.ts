import { finishReviewComplete, finishReviewFailed, startReview } from "@varroom/db";
import type { FinishedClaim, FinishedEvidence } from "@varroom/db";
import { DEFAULT_GEMINI_MODEL, PipelineError } from "./types.ts";
import type { ClaimResult } from "./types.ts";
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
export function geminiModel(): string {
  const fromEnv = process.env.GEMINI_MODEL;
  if (fromEnv) {
    return fromEnv;
  }
  return DEFAULT_GEMINI_MODEL;
}

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

  // 1. run the agents
  let output: PipelineOutput;
  try {
    output = await runPipeline(text, options);
  } catch (err) {
    await markFailed(reviewId, failureReasonFor(err));
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
      inputTokens: 0, // token counting comes later, with usage tracking
      outputTokens: 0,
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

export { PipelineError } from "./types.ts";
export type { PipelineOptions, RunAgentFn, SearchWebFn } from "./pipeline.ts";
