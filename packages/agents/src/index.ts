import {
  createReview,
  startReview,
  completeReview,
  failReview,
  createClaim,
  updateClaim,
  createEvidence,
  createClaimEvidence,
} from "@varroom/db";
import { PipelineError, DEFAULT_GEMINI_MODEL } from "./types.ts";
import type { ReviewResult } from "./types.ts";
import { runPipeline } from "./pipeline.ts";
import type { PipelineOptions, EvidenceEntry } from "./pipeline.ts";

// The review result plus the evidence ledger, so callers like the CLI can print it.
export type ReviewDebateResult = ReviewResult & { evidence: EvidenceEntry[] };

// The main entry point for the agent pipeline. Creates a Review row, runs
// the Moderator -> search -> Fact Checker pipeline, persists the results,
// and returns a ReviewResult. If any step fails, the review is marked FAILED
// and the error is rethrown so the caller (the CLI or the future API) can
// report it. Rows already written are kept — there is no rollback.
export async function reviewDebate(
  debateId: string,
  text: string,
  options?: PipelineOptions,
): Promise<ReviewDebateResult> {
  const model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;

  // Create the review row first so every subsequent write has a reviewId.
  const reviewId = await createReview({ debateId, model });

  try {
    await startReview(reviewId);

    const output = await runPipeline(text, options);

    // Persist evidence rows (written by code, scoped to this review).
    const evidenceIdByLabel = new Map<string, string>();
    for (const entry of output.evidence) {
      const evidenceId = await createEvidence({
        reviewId,
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
      evidenceIdByLabel.set(entry.label, evidenceId);
    }

    // Persist claim rows and their verdicts.
    for (const claim of output.claims) {
      const claimId = await createClaim({
        reviewId,
        order: claim.order,
        claimText: claim.claimText,
        type: claim.type === "UNTESTABLE" ? "UNTESTABLE" : "POSITIONAL_ROLE",
        entities: {},
      });

      if (claim.verdict !== "UNTESTABLE") {
        await updateClaim(claimId, claim.verdict, claim.reasoning, claim.confidence);
      }

      // Link the claim to its cited evidence rows.
      for (const label of claim.citedLabels) {
        const evidenceId = evidenceIdByLabel.get(label);
        if (evidenceId) {
          await createClaimEvidence(claimId, evidenceId);
        }
      }
    }

    await completeReview(reviewId, output.score, output.decision, 0, 0);

    return {
      reviewId,
      status: "COMPLETE",
      claims: output.claims,
      score: output.score,
      decision: output.decision,
      evidence: output.evidence,
    };
  } catch (err) {
    const reason =
      err instanceof PipelineError
        ? `${err.step}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);

    await failReview(reviewId, reason).catch(() => {
      // never let a failReview write error shadow the original error
    });

    throw err;
  }
}

export type { ReviewResult };
