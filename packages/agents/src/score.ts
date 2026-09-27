import type { ClaimResult, ReviewResult } from "./types.ts";

// Computes a 0-100 credibility score from the final claim verdicts.
// Only VERIFIED, PARTIALLY_TRUE, and REFUTED claims count.
// INSUFFICIENT_DATA and UNTESTABLE are excluded from both numerator and denominator
// so they cannot inflate or deflate the score.
//
// Formula: round(100 * (V + 0.5 * P) / (V + P + R))
// Returns null when there are zero testable claims (denominator is zero).
export function computeScore(claims: ClaimResult[]): number | null {
  let verified = 0;
  let partial = 0;
  let refuted = 0;

  for (const claim of claims) {
    if (claim.verdict === "VERIFIED") verified++;
    else if (claim.verdict === "PARTIALLY_TRUE") partial++;
    else if (claim.verdict === "REFUTED") refuted++;
  }

  const denominator = verified + partial + refuted;
  if (denominator === 0) return null;

  return Math.round((100 * (verified + 0.5 * partial)) / denominator);
}

// Derives the VAR decision from the score.
// null score (no testable claims) → INCONCLUSIVE
// >= 50 → CONFIRMED (Decision stands)
// < 50  → OVERTURNED
export function computeDecision(score: number | null): ReviewResult["decision"] {
  if (score === null) return "INCONCLUSIVE";
  return score >= 50 ? "CONFIRMED" : "OVERTURNED";
}
