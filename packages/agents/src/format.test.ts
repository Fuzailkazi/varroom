import { describe, expect, test } from "bun:test";
import { formatReview } from "./format.ts";
import type { ReviewRunResult } from "./index.ts";
import type { EvidenceEntry } from "./pipeline.ts";
import type { ClaimResult } from "./types.ts";

// formatReview is pure, so these are plain unit tests on the printed text.

function evidence(label: string, claimOrder: number, error: string | null = null): EvidenceEntry {
  return {
    label,
    toolName: "searchWeb",
    args: { claimOrder, query: "q" },
    result: error ? {} : { url: `https://${label}.com`, title: `${label}.com` },
    kind: "WEB",
    sourceUrl: error ? null : `https://${label}.com`,
    sourceTitle: error ? null : `${label.toLowerCase()}.com`,
    publishedAt: null,
    error,
  };
}

const testableClaim: ClaimResult = {
  order: 1,
  claimText: "Bellingham is better as a false 9 than as an 8",
  entities: { player: "Bellingham", positionA: "false 9", positionB: "8" },
  type: "POSITIONAL_ROLE",
  verdict: "VERIFIED",
  reasoning: "Two sites agree.",
  citedLabels: ["E1", "E2"],
  confidence: 0.8,
};

const untestableClaim: ClaimResult = {
  order: 2,
  claimText: "Guardiola is overrated",
  entities: { player: "", positionA: "" },
  type: "UNTESTABLE",
  verdict: "UNTESTABLE",
  reasoning: null,
  citedLabels: [],
  confidence: null,
};

function result(overrides: Partial<ReviewRunResult>): ReviewRunResult {
  return {
    reviewId: "review-1",
    saved: true,
    claims: [testableClaim, untestableClaim],
    evidence: [evidence("E1", 1), evidence("E2", 1)],
    score: 100,
    decision: "CONFIRMED",
    summary: "2 claims: 1 stands, 1 not testable",
    ...overrides,
  };
}

describe("formatReview", () => {
  test("prints claims, then the evidence ledger, then verdicts, then the score", () => {
    const text = formatReview(result({}));

    const claimsAt = text.indexOf("=== Claims ===");
    const ledgerAt = text.indexOf("=== Evidence ledger ===");
    const verdictsAt = text.indexOf("=== Verdicts ===");
    const resultAt = text.indexOf("=== Result ===");

    expect(claimsAt).toBeGreaterThanOrEqual(0);
    expect(ledgerAt).toBeGreaterThan(claimsAt);
    expect(verdictsAt).toBeGreaterThan(ledgerAt);
    expect(resultAt).toBeGreaterThan(verdictsAt);
  });

  test("each ledger row shows its label, the claim it was gathered for, and the source", () => {
    const text = formatReview(result({}));

    expect(text).toContain("E1 (for claim 1) e1.com");
    expect(text).toContain("   https://E1.com");
  });

  test("a failed search row shows its error instead of a source", () => {
    const text = formatReview(
      result({ evidence: [evidence("E1", 1, "Search timed out after 60s")] }),
    );

    expect(text).toContain("E1 (for claim 1) ERROR: Search timed out after 60s");
  });

  test("a testable claim's verdict lists the evidence labels it cites", () => {
    const text = formatReview(result({}));

    expect(text).toContain("Claim 1: VERIFIED (cites: E1, E2)");
    expect(text).toContain("Confidence: 0.8");
  });

  test("an untestable claim is listed with a not checked note and gets no verdict line", () => {
    const text = formatReview(result({}));

    expect(text).toContain('Claim 2 [UNTESTABLE]: "Guardiola is overrated"');
    expect(text).toContain("Not checked");
    expect(text).not.toContain("Claim 2: UNTESTABLE");
  });

  test("prints the score and decision when there is a score", () => {
    const text = formatReview(result({ score: 0, decision: "OVERTURNED" }));

    expect(text).toContain("Score: 0/100");
    expect(text).toContain("Decision: OVERTURNED");
  });

  test("says no testable claims when every claim is untestable", () => {
    const text = formatReview(
      result({ claims: [untestableClaim], evidence: [], score: null, decision: "INCONCLUSIVE" }),
    );

    expect(text).toContain("no testable claims, INCONCLUSIVE");
    expect(text).toContain("(no searches were run)");
    expect(text).not.toContain("Score:");
  });

  test("says no claim could be scored when testable claims all came back incomplete", () => {
    const incomplete: ClaimResult = {
      ...testableClaim,
      verdict: "INSUFFICIENT_DATA",
      reasoning: "Citation check failed (zero labels cited).",
      citedLabels: [],
      confidence: null,
    };

    const text = formatReview(
      result({ claims: [incomplete], score: null, decision: "INCONCLUSIVE" }),
    );

    expect(text).toContain("no claim could be scored, INCONCLUSIVE");
    expect(text).toContain("Claim 1: INSUFFICIENT_DATA (cites: none)");
  });

  test("ends with the review id so the saved review can be looked up", () => {
    const text = formatReview(result({ reviewId: "abc-123" }));

    expect(text.trimEnd().endsWith("Review id: abc-123")).toBe(true);
  });
});
