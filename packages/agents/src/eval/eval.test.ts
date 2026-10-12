import { describe, expect, test } from "bun:test";
import type { EvalRunReport } from "./eval.ts";
import { runEvaluation } from "./eval.ts";
import { GOLDEN_DEBATES } from "./goldenSet.ts";
import { estimateCostUsd, formatEvalReport } from "./report.ts";

describe("golden eval dataset", () => {
  test("contains at least 20 real debates with valid structure", () => {
    expect(GOLDEN_DEBATES.length).toBeGreaterThanOrEqual(20);

    for (const debate of GOLDEN_DEBATES) {
      expect(debate.id).toMatch(/^golden-\d+$/);
      expect(debate.title.length).toBeGreaterThan(10);
      expect(debate.thesis.length).toBeGreaterThan(10);
      expect(debate.expectedClaims.length).toBeGreaterThanOrEqual(1);
      expect(["CONFIRMED", "OVERTURNED", "INCONCLUSIVE"]).toContain(debate.roughExpectedVerdict);

      for (const claim of debate.expectedClaims) {
        expect(claim.order).toBeGreaterThanOrEqual(1);
        expect(claim.claimText.length).toBeGreaterThan(5);
        expect([
          "POSITIONAL_ROLE",
          "COMPARISON",
          "TEAM_TACTIC",
          "TRANSFER_FIT",
          "UNTESTABLE",
        ]).toContain(claim.type);
      }
    }
  });

  test("covers all required claim categories", () => {
    const categories = new Set(GOLDEN_DEBATES.map((d) => d.category));
    expect(categories.has("POSITIONAL_ROLE")).toBe(true);
    expect(categories.has("COMPARISON")).toBe(true);
    expect(categories.has("TEAM_TACTIC")).toBe(true);
    expect(categories.has("TRANSFER_FIT")).toBe(true);
    expect(categories.has("UNTESTABLE")).toBe(true);
    expect(categories.has("MIXED")).toBe(true);
  });
});

describe("evaluation cost and report formatting", () => {
  test("calculates estimated USD cost from token counts", () => {
    // 1 million input tokens = $0.15, 1 million output tokens = $0.60
    const cost = estimateCostUsd(1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.75, 4);

    // 10,000 input tokens and 2,000 output tokens
    const sampleCost = estimateCostUsd(10_000, 2_000);
    expect(sampleCost).toBeCloseTo(0.0027, 4);
  });

  test("formats the quality report into a readable terminal summary", () => {
    const fakeReport: EvalRunReport = {
      debates: [
        {
          id: "golden-01",
          title: "Bellingham is better as a false 9",
          category: "POSITIONAL_ROLE",
          expectedClaimCount: 1,
          actualClaimCount: 1,
          claimSplitMatchRate: 1.0,
          validCitations: 2,
          totalCitations: 2,
          citationValidityRate: 1.0,
          decision: "CONFIRMED",
          expectedDecision: "CONFIRMED",
          verdictAgreement: true,
          score: 80,
          inputTokens: 1200,
          outputTokens: 250,
          thinkingTokens: 0,
          costUsd: 0.0003,
          durationMs: 850,
          callsCount: 3,
        },
      ],
      totalDebates: 1,
      totalExpectedClaims: 1,
      totalActualClaims: 1,
      claimSplitQuality: 1.0,
      citationValidityRate: 1.0,
      verdictAgreementRate: 1.0,
      decisionAgreementRate: 1.0,
      totalCalls: 3,
      averageInputTokens: 1200,
      averageOutputTokens: 250,
      averageThinkingTokens: 0,
      averageCostUsd: 0.0003,
      totalCostUsd: 0.0003,
      budgetRemaining: 97,
    };

    const text = formatEvalReport(fakeReport);
    expect(text).toContain("VAR ROOM AGENT EVALUATION REPORT");
    expect(text).toContain("golden-01");
    expect(text).toContain("Claim Split Quality     : 100.0%");
    expect(text).toContain("Citation Validity Rate  : 100.0%");
    expect(text).toContain("Verdict Agreement Rate  : 100.0%");
    expect(text).toContain("Total Evaluation Cost   : $0.0003");
  });
});

describe("runEvaluation runner", () => {
  test("runs mock benchmark for sample debates and reports quality metrics", async () => {
    const report = await runEvaluation({
      mode: "mock",
      limit: 2,
    });

    expect(report.totalDebates).toBe(2);
    expect(report.debates).toHaveLength(2);
    expect(report.claimSplitQuality).toBe(1.0);
    expect(report.citationValidityRate).toBe(1.0);
    expect(report.verdictAgreementRate).toBe(1.0);
    expect(report.totalCalls).toBeGreaterThan(0);
    expect(report.averageCostUsd).toBeGreaterThan(0);
  });

  test("runs evaluation for a single debate by id", async () => {
    const report = await runEvaluation({
      mode: "mock",
      singleId: "golden-03",
    });

    expect(report.totalDebates).toBe(1);
    expect(report.debates[0]?.id).toBe("golden-03");
    expect(report.debates[0]?.category).toBe("COMPARISON");
  });
});
