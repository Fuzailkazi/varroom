// Citation validation: every label a Fact Checker verdict cites must
// (a) exist in the evidence ledger for this review, and
// (b) have been gathered for the same claim (matched by claimOrder in args).
//
// If either check fails, or the verdict cites zero labels, the claim is
// downgraded to INSUFFICIENT_DATA by the caller. This is what makes the
// evidence ledger meaningful: the model cannot fabricate a label or
// borrow evidence from another claim.

export type EvidenceRecord = {
  label: string; // "E1", "E2", ...
  args: { claimOrder: number; query: string };
  error?: string | null;
};

export type CitationCheckResult =
  | { ok: true; validLabels: string[] }
  | { ok: false; invalidLabels: string[] };

// Checks that every label in citedLabels:
// - exists in the evidence records for this review
// - belongs to the same claim (args.claimOrder === claimOrder)
// Returns ok: true with the valid labels, or ok: false listing the bad ones.
export function validateCitations(
  citedLabels: string[],
  claimOrder: number,
  evidence: EvidenceRecord[]
): CitationCheckResult {
  if (citedLabels.length === 0) {
    return { ok: false, invalidLabels: [] };
  }

  // build a lookup from label to the claim it was gathered for
  const labelToClaimOrder = new Map<string, number>();
  for (const e of evidence) {
    labelToClaimOrder.set(e.label, e.args.claimOrder);
  }

  const invalid: string[] = [];
  for (const label of citedLabels) {
    const owner = labelToClaimOrder.get(label);
    if (owner === undefined || owner !== claimOrder) {
      invalid.push(label);
    }
  }

  if (invalid.length > 0) {
    return { ok: false, invalidLabels: invalid };
  }

  return { ok: true, validLabels: citedLabels };
}
