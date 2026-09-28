import type { BudgetStatus, ReviewTrace, ReviewTraceCall } from "@varroom/db";

// Turns a review's trace, or today's budget, into the text `bun run trace` prints.
// Pure functions, so the tests can check the text without a database.

// helpers

// "850ms" under a second, else seconds with one decimal like "12.3s"
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  return `${seconds.toFixed(1)}s`;
}

// how long the review ran. it has no end time while it's still going
function reviewDuration(trace: ReviewTrace): string {
  if (trace.completedAt === null) {
    return "still running";
  }
  // a review can end without ever starting, e.g. the runner crashed while it was QUEUED
  if (trace.startedAt === null) {
    return "never started";
  }
  const ms = trace.completedAt.getTime() - trace.startedAt.getTime();
  return formatDuration(ms);
}

function formatTokens(inputTokens: number, outputTokens: number, thinkingTokens: number): string {
  return `tokens in ${inputTokens} / out ${outputTokens} / thinking ${thinkingTokens}`;
}

// one call on one line, e.g.
// "2. SEARCH attempt 1 (claim 3), ERROR, tokens in 0 / out 0 / thinking 0, 1.2s, error: Gemini error 503"
function formatCall(call: ReviewTraceCall, position: number): string {
  let what = `${position}. ${call.step} attempt ${call.attempt}`;
  // only searches belong to a claim
  if (call.claimOrder !== null) {
    what = `${what} (claim ${call.claimOrder})`;
  }

  const parts: string[] = [
    what,
    call.status,
    formatTokens(call.inputTokens, call.outputTokens, call.thinkingTokens),
    formatDuration(call.durationMs),
  ];
  if (call.error !== null) {
    parts.push(`error: ${call.error}`);
  }
  return parts.join(", ");
}

// "2026-09-29 07:00 UTC (Sep 29, 12:00 AM PDT)". the budget resets at midnight pacific,
// so both clocks are shown
export function formatResetTime(at: Date): string {
  // toISOString is always utc: "2026-09-29T07:00:00.000Z"
  const iso = at.toISOString();
  const utc = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

  // the date and the time are formatted apart: formatting them together joins them
  // with "," or " at" depending on the runtime's version, and we want the same text everywhere
  const pacificDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  }).format(at);
  const pacificTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);

  return `${utc} (${pacificDate}, ${pacificTime})`;
}

// the views

// a review's status, duration, totals and then one line per call, oldest first
export function formatTrace(trace: ReviewTrace): string {
  const lines: string[] = [];

  lines.push(`=== Review ${trace.id} ===`);
  lines.push(`Status: ${trace.status}`);
  lines.push(`Debate: ${trace.debateId}`);
  lines.push(`Duration: ${reviewDuration(trace)}`);
  lines.push(
    `Totals: ${trace.aiCallCount} calls, ` +
      formatTokens(trace.inputTokens, trace.outputTokens, trace.thinkingTokens),
  );

  lines.push("");
  lines.push("=== Calls ===");
  if (trace.callsDeleted) {
    // the rows were cleaned up, only the totals above are left
    lines.push("The per call detail is deleted after 48 hours. Only the totals above are kept.");
  } else if (trace.calls.length === 0) {
    lines.push("(no calls recorded yet)");
  } else {
    for (let i = 0; i < trace.calls.length; i++) {
      lines.push(formatCall(trace.calls[i]!, i + 1));
    }
  }

  return lines.join("\n");
}

// today's gemini budget: the limit, what's used and reserved, what's left, and the reset time
export function formatBudget(budget: BudgetStatus): string {
  const lines: string[] = [];

  lines.push("=== Today's Gemini budget ===");
  lines.push(`Daily limit: ${budget.limit} calls`);
  lines.push(`Used today (since midnight Pacific): ${budget.used} calls`);
  lines.push(`Reserved by running reviews: ${budget.reserved} calls`);
  lines.push(`Left: ${budget.left} calls`);
  if (budget.open) {
    lines.push("New reviews: open");
  } else {
    lines.push("New reviews: closed until the reset");
  }
  lines.push(`Resets at: ${formatResetTime(budget.resetsAt)}`);

  return lines.join("\n");
}
