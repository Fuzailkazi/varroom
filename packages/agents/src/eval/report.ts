import type { EvalRunReport } from "./eval.ts";

// Estimates cost in USD based on Gemini 2.5 Flash pricing:
// Input: $0.15 per million tokens ($0.00000015/token)
// Output: $0.60 per million tokens ($0.00000060/token)
export function estimateCostUsd(
	inputTokens: number,
	outputTokens: number,
): number {
	const inputCost = (inputTokens / 1_000_000) * 0.15;
	const outputCost = (outputTokens / 1_000_000) * 0.6;
	return inputCost + outputCost;
}

// Formats a number as a percentage string with one decimal place.
function formatPercent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

// Formats cost as USD with 4 decimal places.
function formatCost(usd: number): string {
	return `$${usd.toFixed(4)}`;
}

// Formats the evaluation results into a readable terminal quality report.
export function formatEvalReport(report: EvalRunReport): string {
	const lines: string[] = [];

	lines.push(
		"================================================================================",
	);
	lines.push(
		"                          VAR ROOM AGENT EVALUATION REPORT                      ",
	);
	lines.push(
		"================================================================================",
	);
	lines.push("");

	// Per-debate summary table
	lines.push(
		[
			"ID".padEnd(11),
			"Category".padEnd(17),
			"Claims (Act/Exp)".padEnd(18),
			"Citations".padEnd(12),
			"Verdict Match".padEnd(15),
			"Decision".padEnd(14),
			"Cost",
		].join(" "),
	);
	lines.push("-".repeat(95));

	for (const item of report.debates) {
		const claimsText =
			`${item.actualClaimCount}/${item.expectedClaimCount}`.padEnd(18);
		const citationsText =
			`${item.validCitations}/${item.totalCitations}`.padEnd(12);
		const verdictText = (item.verdictAgreement ? "MATCH" : "DIFF").padEnd(15);
		const decisionText = item.decision.padEnd(14);
		const costText = formatCost(item.costUsd);

		lines.push(
			[
				item.id.padEnd(11),
				item.category.padEnd(17),
				claimsText,
				citationsText,
				verdictText,
				decisionText,
				costText,
			].join(" "),
		);
	}

	lines.push("-".repeat(95));
	lines.push("");

	// Aggregate Benchmark Summary
	lines.push("=== QUALITY & PERFORMANCE METRICS ===");
	lines.push(`Total Debates Evaluated : ${report.totalDebates}`);
	lines.push(
		`Total Claims Extracted  : ${report.totalActualClaims} (expected: ${report.totalExpectedClaims})`,
	);
	lines.push(
		`Claim Split Quality     : ${formatPercent(report.claimSplitQuality)}`,
	);
	lines.push(
		`Citation Validity Rate  : ${formatPercent(report.citationValidityRate)}`,
	);
	lines.push(
		`Verdict Agreement Rate  : ${formatPercent(report.verdictAgreementRate)}`,
	);
	lines.push(
		`Decision Agreement Rate : ${formatPercent(report.decisionAgreementRate)}`,
	);
	lines.push("");

	lines.push("=== USAGE & COST METRICS ===");
	lines.push(`Total Gemini Calls Made : ${report.totalCalls}`);
	lines.push(
		`Average Input Tokens    : ${Math.round(report.averageInputTokens)}`,
	);
	lines.push(
		`Average Output Tokens   : ${Math.round(report.averageOutputTokens)}`,
	);
	lines.push(
		`Average Thinking Tokens : ${Math.round(report.averageThinkingTokens)}`,
	);
	lines.push(`Average Cost Per Review : ${formatCost(report.averageCostUsd)}`);
	lines.push(`Total Evaluation Cost   : ${formatCost(report.totalCostUsd)}`);

	if (report.budgetRemaining !== null) {
		lines.push(`Daily Call Budget Left  : ${report.budgetRemaining} calls`);
	}

	lines.push(
		"================================================================================",
	);

	return lines.join("\n");
}
