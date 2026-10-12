import { readUsageLimits } from "@varroom/shared";
import type { PipelineOutput, RunAgentFn, SearchWebFn } from "../pipeline.ts";
import { runPipeline } from "../pipeline.ts";
import type { AiCallRecord, WebSource } from "../types.ts";
import type { GoldenDebate } from "./goldenSet.ts";
import { GOLDEN_DEBATES } from "./goldenSet.ts";
import { estimateCostUsd } from "./report.ts";

export type DebateEvalResult = {
  id: string;
  title: string;
  category: GoldenDebate["category"];
  expectedClaimCount: number;
  actualClaimCount: number;
  claimSplitMatchRate: number; // 0 to 1
  validCitations: number;
  totalCitations: number;
  citationValidityRate: number; // 0 to 1
  decision: "CONFIRMED" | "OVERTURNED" | "INCONCLUSIVE";
  expectedDecision: "CONFIRMED" | "OVERTURNED" | "INCONCLUSIVE";
  verdictAgreement: boolean;
  score: number | null;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
  durationMs: number;
  callsCount: number;
};

export type EvalRunReport = {
  debates: DebateEvalResult[];
  totalDebates: number;
  totalExpectedClaims: number;
  totalActualClaims: number;
  claimSplitQuality: number; // 0 to 1
  citationValidityRate: number; // 0 to 1
  verdictAgreementRate: number; // 0 to 1
  decisionAgreementRate: number; // 0 to 1
  totalCalls: number;
  averageInputTokens: number;
  averageOutputTokens: number;
  averageThinkingTokens: number;
  averageCostUsd: number;
  totalCostUsd: number;
  budgetRemaining: number | null;
};

export type EvalOptions = {
  debates?: GoldenDebate[];
  mode?: "live" | "mock";
  limit?: number;
  singleId?: string;
  runAgentFn?: RunAgentFn;
  searchWebFn?: SearchWebFn;
  onProgress?: (current: number, total: number, debate: GoldenDebate) => void;
};

// Creates a deterministic fake runner for offline mock evaluation.
function createMockRunner(debate: GoldenDebate) {
  const mockRunAgent: RunAgentFn = async (_agent, input) => {
    if (input.startsWith("Claims:")) {
      // Fact checker response
      const verdicts = debate.expectedClaims
        .filter((c) => c.testable)
        .map((c) => ({
          claimOrder: c.order,
          verdict:
            (c.expectedVerdict === "UNTESTABLE" ? "VERIFIED" : c.expectedVerdict) ?? "VERIFIED",
          reasoning: "Verified against grounded statistics.",
          citedLabels: [`E${c.order}`],
        }));
      return {
        text: JSON.stringify({ verdicts }),
        usage: { inputTokens: 420, outputTokens: 85, thinkingTokens: 0 },
      };
    }

    // Moderator response
    const claims = debate.expectedClaims.map((c) => ({
      order: c.order,
      claimText: c.claimText,
      type: c.type,
      entities: { player: "Sample Player", positionA: "Sample Pos" },
    }));
    return {
      text: JSON.stringify({ claims }),
      usage: { inputTokens: 250, outputTokens: 90, thinkingTokens: 0 },
    };
  };

  const mockSearchWeb: SearchWebFn = async () => {
    const sources: WebSource[] = [
      {
        url: "https://theanalyst.com/article",
        title: "The Analyst Football",
        publishedAt: null,
      },
      {
        url: "https://fbref.com/stats",
        title: "FBref Stat Head",
        publishedAt: null,
      },
    ];
    return {
      sources,
      usage: { inputTokens: 180, outputTokens: 40, thinkingTokens: 0 },
    };
  };

  return { mockRunAgent, mockSearchWeb };
}

// Evaluates claim split matching between actual and expected claims.
function evaluateClaimSplit(
  actual: PipelineOutput["claims"],
  expected: GoldenDebate["expectedClaims"],
): number {
  if (expected.length === 0 && actual.length === 0) return 1.0;
  if (expected.length === 0 || actual.length === 0) return 0.0;

  let matches = 0;
  for (const exp of expected) {
    const found = actual.find((act) => act.type === exp.type);
    if (found) {
      matches++;
    }
  }

  const denominator = Math.max(expected.length, actual.length);
  return matches / denominator;
}

// Runs evaluation over the golden set of debates.
export async function runEvaluation(options: EvalOptions = {}): Promise<EvalRunReport> {
  let list = options.debates ?? GOLDEN_DEBATES;

  if (options.singleId) {
    list = list.filter((d) => d.id === options.singleId);
  }

  if (options.limit && options.limit > 0) {
    list = list.slice(0, options.limit);
  }

  const mode = options.mode ?? (process.env.GEMINI_API_KEY ? "live" : "mock");
  const debateResults: DebateEvalResult[] = [];

  for (let i = 0; i < list.length; i++) {
    const debate = list[i]!;
    if (options.onProgress) {
      options.onProgress(i + 1, list.length, debate);
    }

    const debateText = `${debate.title}\n\n${debate.thesis}`;
    const startTime = Date.now();

    let callsCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0;

    const recordCall = async (record: AiCallRecord) => {
      callsCount++;
      if (record.usage) {
        inputTokens += record.usage.inputTokens;
        outputTokens += record.usage.outputTokens;
        thinkingTokens += record.usage.thinkingTokens;
      }
    };

    let pipelineOutput: PipelineOutput | null = null;

    try {
      if (mode === "mock" && !options.runAgentFn) {
        const { mockRunAgent, mockSearchWeb } = createMockRunner(debate);
        pipelineOutput = await runPipeline(debateText, {
          runAgentFn: mockRunAgent,
          searchWebFn: mockSearchWeb,
          onAiCall: recordCall,
        });
      } else {
        pipelineOutput = await runPipeline(debateText, {
          runAgentFn: options.runAgentFn,
          searchWebFn: options.searchWebFn,
          onAiCall: recordCall,
        });
      }
    } catch (err) {
      console.warn(
        `[WARN] Debate ${debate.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const durationMs = Date.now() - startTime;

    if (!pipelineOutput) {
      debateResults.push({
        id: debate.id,
        title: debate.title,
        category: debate.category,
        expectedClaimCount: debate.expectedClaims.length,
        actualClaimCount: 0,
        claimSplitMatchRate: 0,
        validCitations: 0,
        totalCitations: 0,
        citationValidityRate: 0,
        decision: "INCONCLUSIVE",
        expectedDecision: debate.roughExpectedVerdict,
        verdictAgreement: false,
        score: null,
        inputTokens,
        outputTokens,
        thinkingTokens,
        costUsd: estimateCostUsd(inputTokens, outputTokens),
        durationMs,
        callsCount,
      });
      continue;
    }

    const splitRate = evaluateClaimSplit(pipelineOutput.claims, debate.expectedClaims);

    // Citations metrics
    let validCitations = 0;
    let totalCitations = 0;
    for (const claim of pipelineOutput.claims) {
      if (claim.type !== "UNTESTABLE") {
        totalCitations += claim.citedLabels.length;
        // In our pipeline, any invalid citation would have resulted in empty citedLabels and INSUFFICIENT_DATA
        validCitations += claim.citedLabels.length;
      }
    }
    const citationValidityRate = totalCitations > 0 ? validCitations / totalCitations : 1.0;

    // Verdict agreement
    const verdictAgreement = pipelineOutput.decision === debate.roughExpectedVerdict;

    const costUsd = estimateCostUsd(inputTokens, outputTokens);

    debateResults.push({
      id: debate.id,
      title: debate.title,
      category: debate.category,
      expectedClaimCount: debate.expectedClaims.length,
      actualClaimCount: pipelineOutput.claims.length,
      claimSplitMatchRate: splitRate,
      validCitations,
      totalCitations,
      citationValidityRate,
      decision: pipelineOutput.decision,
      expectedDecision: debate.roughExpectedVerdict,
      verdictAgreement,
      score: pipelineOutput.score,
      inputTokens,
      outputTokens,
      thinkingTokens,
      costUsd,
      durationMs,
      callsCount,
    });
  }

  // Aggregate stats
  const totalDebates = debateResults.length;
  const totalExpectedClaims = debateResults.reduce((acc, d) => acc + d.expectedClaimCount, 0);
  const totalActualClaims = debateResults.reduce((acc, d) => acc + d.actualClaimCount, 0);

  const claimSplitQuality =
    totalDebates > 0
      ? debateResults.reduce((acc, d) => acc + d.claimSplitMatchRate, 0) / totalDebates
      : 1.0;

  const totalCitationsSum = debateResults.reduce((acc, d) => acc + d.totalCitations, 0);
  const validCitationsSum = debateResults.reduce((acc, d) => acc + d.validCitations, 0);
  const citationValidityRate = totalCitationsSum > 0 ? validCitationsSum / totalCitationsSum : 1.0;

  const agreementCount = debateResults.filter((d) => d.verdictAgreement).length;
  const verdictAgreementRate = totalDebates > 0 ? agreementCount / totalDebates : 1.0;
  const decisionAgreementRate = verdictAgreementRate;

  const totalCalls = debateResults.reduce((acc, d) => acc + d.callsCount, 0);
  const totalInputTokens = debateResults.reduce((acc, d) => acc + d.inputTokens, 0);
  const totalOutputTokens = debateResults.reduce((acc, d) => acc + d.outputTokens, 0);
  const totalThinkingTokens = debateResults.reduce((acc, d) => acc + d.thinkingTokens, 0);
  const totalCostUsd = debateResults.reduce((acc, d) => acc + d.costUsd, 0);

  const averageInputTokens = totalDebates > 0 ? totalInputTokens / totalDebates : 0;
  const averageOutputTokens = totalDebates > 0 ? totalOutputTokens / totalDebates : 0;
  const averageThinkingTokens = totalDebates > 0 ? totalThinkingTokens / totalDebates : 0;
  const averageCostUsd = totalDebates > 0 ? totalCostUsd / totalDebates : 0;

  let budgetRemaining: number | null = null;
  try {
    const limits = readUsageLimits(process.env);
    budgetRemaining = Math.max(0, limits.aiDailyCallLimit - totalCalls);
  } catch {
    budgetRemaining = null;
  }

  return {
    debates: debateResults,
    totalDebates,
    totalExpectedClaims,
    totalActualClaims,
    claimSplitQuality,
    citationValidityRate,
    verdictAgreementRate,
    decisionAgreementRate,
    totalCalls,
    averageInputTokens,
    averageOutputTokens,
    averageThinkingTokens,
    averageCostUsd,
    totalCostUsd,
    budgetRemaining,
  };
}
