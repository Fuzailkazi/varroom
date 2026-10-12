#!/usr/bin/env bun
import { readUsageLimits } from "@varroom/shared";
import { runEvaluation } from "./eval.ts";
import { GOLDEN_DEBATES } from "./goldenSet.ts";
import { formatEvalReport } from "./report.ts";

function parseArgs(args: string[]) {
  let mode: "live" | "mock" | undefined;
  let limit: number | undefined;
  let singleId: string | undefined;
  let outputJson = false;

  for (const arg of args) {
    if (arg === "--mock" || arg === "--mode=mock") {
      mode = "mock";
    } else if (arg === "--live" || arg === "--mode=live") {
      mode = "live";
    } else if (arg.startsWith("--limit=")) {
      limit = parseInt(arg.slice("--limit=".length), 10);
    } else if (arg.startsWith("--sample=")) {
      limit = parseInt(arg.slice("--sample=".length), 10);
    } else if (arg.startsWith("--id=")) {
      singleId = arg.slice("--id=".length);
    } else if (arg === "--json") {
      outputJson = true;
    }
  }

  return { mode, limit, singleId, outputJson };
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  const hasApiKey = Boolean(process.env.GEMINI_API_KEY);
  const selectedMode = options.mode ?? (hasApiKey ? "live" : "mock");

  console.log(`Running VAR Room debate evaluation (mode: ${selectedMode})...`);

  if (selectedMode === "live") {
    if (!hasApiKey) {
      console.error(
        "GEMINI_API_KEY is not set. To run live evaluations against real Gemini, set GEMINI_API_KEY in .env.",
      );
      console.error("Falling back to mock mode or pass --mock to run offline benchmark.");
      process.exit(1);
    }

    try {
      const limits = readUsageLimits(process.env);
      console.log(`Daily Gemini call limit: ${limits.aiDailyCallLimit} calls/day.`);
    } catch {
      // ignore
    }
  }

  const countToRun = options.singleId
    ? 1
    : options.limit
      ? Math.min(options.limit, GOLDEN_DEBATES.length)
      : GOLDEN_DEBATES.length;

  console.log(`Evaluating ${countToRun} golden debate(s)...`);

  const report = await runEvaluation({
    mode: selectedMode,
    limit: options.limit,
    singleId: options.singleId,
    onProgress: (current, total, debate) => {
      console.log(`[${current}/${total}] Evaluating: "${debate.title.slice(0, 50)}..."`);
    },
  });

  console.log("");
  if (options.outputJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatEvalReport(report));
  }
}

main().catch((err) => {
  console.error("Evaluation run failed:", err);
  process.exit(1);
});
