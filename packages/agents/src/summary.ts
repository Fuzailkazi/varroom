import type { ClaimResult } from "./types.ts";

// one line summary of a finished review, e.g. "3 claims: 1 stands, 1 overturned, 1 couldn't be checked".
// built by code from the verdicts, so it never says anything the verdicts don't
export function buildSummary(claims: ClaimResult[]): string {
  let stands = 0;
  let partlyStands = 0;
  let overturned = 0;
  let notChecked = 0;
  let notTestable = 0;

  for (const claim of claims) {
    if (claim.verdict === "VERIFIED") {
      stands++;
    } else if (claim.verdict === "PARTIALLY_TRUE") {
      partlyStands++;
    } else if (claim.verdict === "REFUTED") {
      overturned++;
    } else if (claim.verdict === "INSUFFICIENT_DATA") {
      notChecked++;
    } else if (claim.verdict === "UNTESTABLE") {
      notTestable++;
    }
  }

  // only mention the counts that aren't zero, in a fixed order
  const parts: string[] = [];
  if (stands > 0) {
    parts.push(`${stands} stands`);
  }
  if (partlyStands > 0) {
    parts.push(`${partlyStands} partly stands`);
  }
  if (overturned > 0) {
    parts.push(`${overturned} overturned`);
  }
  if (notChecked > 0) {
    parts.push(`${notChecked} couldn't be checked`);
  }
  if (notTestable > 0) {
    parts.push(`${notTestable} not testable`);
  }

  let claimWord = "claims";
  if (claims.length === 1) {
    claimWord = "claim";
  }

  if (parts.length === 0) {
    return `${claims.length} ${claimWord}`;
  }
  return `${claims.length} ${claimWord}: ${parts.join(", ")}`;
}
