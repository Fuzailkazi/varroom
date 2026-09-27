import type { ReviewRunResult } from "./index.ts";

// Turns a finished review into the text the CLI prints, in this order:
// 1. the extracted claims
// 2. the evidence ledger
// 3. each testable claim's verdict and the evidence labels it cites
// 4. the final score and decision
export function formatReview(result: ReviewRunResult): string {
  const lines: string[] = [];

  // 1. Claims
  lines.push("=== Claims ===");
  for (const claim of result.claims) {
    lines.push(`Claim ${claim.order} [${claim.type}]: "${claim.claimText}"`);
    if (claim.type === "UNTESTABLE") {
      lines.push("   Not checked: this kind of claim can't be tested yet, so it is left out of the score.");
    }
  }

  // 2. Evidence ledger
  lines.push("");
  lines.push("=== Evidence ledger ===");
  if (result.evidence.length === 0) {
    lines.push("(no searches were run)");
  }
  for (const entry of result.evidence) {
    const forClaim = `(for claim ${entry.args.claimOrder})`;
    if (entry.error) {
      lines.push(`${entry.label} ${forClaim} ERROR: ${entry.error}`);
    } else {
      lines.push(`${entry.label} ${forClaim} ${entry.sourceTitle}`);
      lines.push(`   ${entry.sourceUrl}`);
    }
  }

  // 3. Verdicts, only for testable claims
  const testableClaims = result.claims.filter((claim) => claim.type !== "UNTESTABLE");
  lines.push("");
  lines.push("=== Verdicts ===");
  if (testableClaims.length === 0) {
    lines.push("(no testable claims)");
  }
  for (const claim of testableClaims) {
    const cited = claim.citedLabels.length > 0 ? claim.citedLabels.join(", ") : "none";
    lines.push(`Claim ${claim.order}: ${claim.verdict} (cites: ${cited})`);
    if (claim.reasoning) {
      lines.push(`   Reasoning: ${claim.reasoning}`);
    }
    if (claim.confidence !== null) {
      lines.push(`   Confidence: ${claim.confidence}`);
    }
  }

  // 4. Score and decision
  lines.push("");
  lines.push("=== Result ===");
  if (result.score !== null) {
    lines.push(`Score: ${result.score}/100`);
    lines.push(`Decision: ${result.decision}`);
  } else if (testableClaims.length === 0) {
    lines.push("no testable claims, INCONCLUSIVE");
  } else {
    // There were testable claims, but none got a verdict that counts
    // toward the score (all came back INSUFFICIENT_DATA).
    lines.push("no claim could be scored, INCONCLUSIVE");
  }

  lines.push("");
  lines.push(`Review id: ${result.reviewId}`);
  return lines.join("\n");
}
