import { LlmAgent, InMemoryRunner, isFinalResponse, stringifyContent } from "@google/adk";
import type { Event } from "@google/adk";
import { MAX_SEARCHED_CLAIMS } from "@varroom/shared";
import { ModeratorOutput, FactCheckerOutput, PipelineError, ReviewStoppedError, geminiModel } from "./types.ts";
import type {
  AgentReply,
  AiCallRecord,
  Claim,
  ClaimResult,
  EvidenceKind,
  ReviewResult,
  SearchReply,
  TokenUsage,
  WebSource,
} from "./types.ts";
import { validateCitations } from "./citations.ts";
import type { EvidenceRecord } from "./citations.ts";
import { computeScore, computeDecision } from "./score.ts";
import { searchWeb as realSearchWeb } from "./search.ts";
import { toTokenUsage } from "./usage.ts";

// An evidence entry built by code during the search loop, never by the model.
export type EvidenceEntry = {
  label: string;
  toolName: string;
  args: { claimOrder: number; query: string };
  result: Record<string, unknown>;
  kind: EvidenceKind;
  sourceUrl: string | null;
  sourceTitle: string | null;
  publishedAt: Date | null;
  error: string | null;
};

// One search attempt. Injectable so tests use a fake instead of Gemini.
export type SearchWebFn = (query: string) => Promise<SearchReply>;

// One agent attempt (no retries, the pipeline does those) — injectable so
// unit tests can replace it with a fake that returns fixed JSON without
// making real Gemini calls. sessionId is the review id when there is one:
// ADK puts it on its tracing spans, so one review's spans group together.
// Fakes can leave it out.
export type RunAgentFn = (agent: LlmAgent, input: string, sessionId?: string) => Promise<AgentReply>;

// told about every gemini attempt once it ends. runReview saves each one as an ai_calls row
export type AiCallFn = (record: AiCallRecord) => Promise<void>;

export type PipelineOutput = {
  claims: ClaimResult[];
  evidence: EvidenceEntry[];
  score: number | null;
  decision: ReviewResult["decision"];
};

// called once the moderator has split the text into claims. the api uses it to stream progress
export type ClaimsExtractedFn = (claims: Claim[]) => Promise<void>;

export type PipelineOptions = {
  searchWebFn?: SearchWebFn;
  runAgentFn?: RunAgentFn;
  onClaimsExtracted?: ClaimsExtractedFn;
  onAiCall?: AiCallFn;
  retryDelayMs?: number; // wait before the first retry, doubled after that. tests pass 0
  reviewId?: string; // handed to runAgentFn as the ADK session id, for tracing
  // asked before every new gemini attempt. true = the review has ended (timed out or
  // deleted), so no new attempt starts and the pipeline throws ReviewStoppedError
  shouldStop?: () => boolean;
};

// error text on the evidence row when a search worked but found nothing
export const NO_SOURCES_ERROR = "No sources returned";

// reasoning saved on a testable claim past the search limit
export const NOT_CHECKED_REASONING = `Not checked: a review checks at most ${MAX_SEARCHED_CLAIMS} claims.`;

// how many times each step may call gemini. these fixed numbers are what cap
// a review at 16 calls, which the daily budget relies on
const AGENT_MAX_ATTEMPTS = 3;
const SEARCH_MAX_ATTEMPTS = 2;

const DEFAULT_RETRY_DELAY_MS = 2000;
const ATTEMPT_TIMEOUT_MS = 60_000;

// Returns which website an evidence row came from, used to count
// independent sources. Gemini grounding gives every source a Google
// redirect URL on the same host, so for those we use the title instead,
// which Gemini sets to the real site's domain (e.g. "wikipedia.org").
function sourceSite(entry: EvidenceEntry): string {
  let host = "";
  try {
    host = new URL(entry.sourceUrl ?? "").hostname;
  } catch {
    host = entry.sourceUrl ?? "";
  }
  if (host === "vertexaisearch.cloud.google.com") {
    return entry.sourceTitle ?? host;
  }
  return host;
}

// true when there was at least one search and every one threw an error.
// "no sources" is a search that worked but found nothing, so it doesn't count
function everySearchThrew(entries: EvidenceEntry[]): boolean {
  if (entries.length === 0) {
    return false;
  }
  for (const entry of entries) {
    if (entry.error === null) {
      return false;
    }
    if (entry.error === NO_SOURCES_ERROR) {
      return false;
    }
  }
  return true;
}

// Builds a grounded search query from a claim's extracted entities.
function buildSearchQuery(claim: Claim): string {
  const { player, positionA, positionB } = claim.entities;
  return positionB
    ? `${player} ${positionA} vs ${positionB} stats`
    : `${player} ${positionA} stats`;
}

// Runs the agent once and returns the model's final text and token usage.
// The session gets the id we were given (the review id), because ADK copies
// the session id onto its tracing spans. With no id, ADK makes one up.
// The runner is new for every attempt, so the id is never already taken,
// and the in memory session goes away with the runner.
async function defaultRunAgent(agent: LlmAgent, input: string, sessionId?: string): Promise<AgentReply> {
  const runner = new InMemoryRunner({ agent, appName: "varroom" });
  const session = await runner.sessionService.createSession({
    appName: "varroom",
    userId: "pipeline",
    sessionId: sessionId,
  });

  const events = runner.runAsync({
    userId: "pipeline",
    sessionId: session.id,
    newMessage: { parts: [{ text: input }] },
  });
  return readAgentEvents(events);
}

// Reads the events of one agent run until the final answer.
// ADK does not throw when Gemini fails: it puts the error on the event
// (errorCode / errorMessage) with no content, so we check for it ourselves.
// Usage comes from the last event that carries it. Gemini's usage on a
// response is already that call's total, so we never add events together.
// We read to the end of the run instead of stopping at the answer: ADK only
// closes its model call tracing span once the run is over, and a span that
// never closes is never sent to tracing.
export async function readAgentEvents(events: AsyncIterable<Event>): Promise<AgentReply> {
  let usage: TokenUsage | null = null;
  let finalText: string | null = null;

  for await (const event of events) {
    if (event.usageMetadata) {
      usage = toTokenUsage(event.usageMetadata);
    }
    if (event.errorMessage) {
      throw new Error(`Gemini error ${event.errorCode ?? ""}: ${event.errorMessage}`);
    }
    if (finalText === null && isFinalResponse(event)) {
      finalText = stringifyContent(event);
    }
  }

  if (finalText === null) {
    throw new Error("The model finished without a final response");
  }
  return { text: finalText, usage: usage };
}

// Gemini sometimes answers "high demand, try again later" (503) or
// "too many requests" (429). Those are worth retrying; anything else is not.
function isTemporaryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /503|429|high demand|overloaded|try again/i.test(message);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs one attempt, failing it if it takes longer than timeoutMs.
// The timer is cleared afterwards so it never keeps the process alive.
async function withTimeout<T>(attemptFn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Gemini call timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([attemptFn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// everything runAttempts needs besides the step and the attempt itself
export type AttemptContext = {
  claimOrder: number | null; // searches only
  model: string;
  retryDelayMs: number;
  timeoutMs: number;
  onAiCall: AiCallFn | undefined;
  shouldStop?: () => boolean; // see PipelineOptions
};

// Runs one gemini step: up to maxAttempts attempts, retrying only temporary
// errors (wait retryDelayMs, then twice that). Every attempt is timed and
// reported to onAiCall once it ends, success or failure, so no call can
// slip past the trace or the daily budget. Throws the last error if no
// attempt worked, or ReviewStoppedError if the review ended before an attempt.
export async function runAttempts<T extends { usage: TokenUsage | null }>(
  step: AiCallRecord["step"],
  maxAttempts: number,
  attemptFn: () => Promise<T>,
  context: AttemptContext
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // the review ended (e.g. timed out): start nothing new. an attempt already
    // running is still reported when it ends, but no retry follows it
    if (context.shouldStop && context.shouldStop()) {
      throw new ReviewStoppedError();
    }

    const startedAt = new Date();
    let reply: T | null = null;
    let failure: unknown = null;

    try {
      reply = await withTimeout(attemptFn, context.timeoutMs);
    } catch (err) {
      failure = err;
    }

    // 1. report the attempt, whatever happened
    if (context.onAiCall) {
      let usage: TokenUsage | null = null;
      let error: string | null = null;
      if (reply !== null) {
        usage = reply.usage;
      } else {
        error = errorMessage(failure);
      }

      await context.onAiCall({
        step: step,
        attempt: attempt,
        claimOrder: context.claimOrder,
        model: context.model,
        status: reply !== null ? "OK" : "ERROR",
        error: error,
        usage: usage,
        durationMs: Date.now() - startedAt.getTime(),
        startedAt: startedAt,
      });
    }

    // 2. it worked
    if (reply !== null) {
      return reply;
    }

    // 3. it failed: give up on the last attempt or on an error a retry won't fix
    const canRetry = attempt < maxAttempts && isTemporaryError(failure);
    if (!canRetry) {
      throw failure;
    }
    await wait(context.retryDelayMs * attempt);
  }
  throw new Error("unreachable");
}

// Which testable claims get searched: the first few by order. A review
// never searches more than MAX_SEARCHED_CLAIMS, so its calls stay capped.
// Returns the orders of the testable claims left out.
function claimsOverSearchLimit(claims: Claim[]): Set<number> {
  const testable: Claim[] = [];
  for (const claim of claims) {
    if (claim.type === "POSITIONAL_ROLE") {
      testable.push(claim);
    }
  }
  testable.sort((a, b) => a.order - b.order);

  const leftOut = new Set<number>();
  for (let index = MAX_SEARCHED_CLAIMS; index < testable.length; index++) {
    leftOut.add(testable[index]!.order);
  }
  return leftOut;
}

// Runs the Moderator → search loop → Fact Checker pipeline.
// Returns the typed results without touching the database.
// searchWebFn and runAgentFn are injectable for unit testing.
export async function runPipeline(
  text: string,
  {
    searchWebFn = realSearchWeb,
    runAgentFn = defaultRunAgent,
    onClaimsExtracted,
    onAiCall,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    reviewId,
    shouldStop,
  }: PipelineOptions = {}
): Promise<PipelineOutput> {
  const model = geminiModel();

  // the settings every attempt shares. searches add their claim order
  const agentContext: AttemptContext = {
    claimOrder: null,
    model: model,
    retryDelayMs: retryDelayMs,
    timeoutMs: ATTEMPT_TIMEOUT_MS,
    onAiCall: onAiCall,
    shouldStop: shouldStop,
  };

  // moderator: split the text into claims
  const moderator = new LlmAgent({
    name: "moderator",
    model,
    instruction: `You are a football debate claim extractor.

Extract every distinct claim from the debate text into the structured JSON schema.

A claim is POSITIONAL_ROLE when it asserts that a specific player performs better or worse in one position compared to another position (e.g. "Bellingham is more effective as a false 9 than as an 8").

Every other claim — a comparison between two players, a team tactic, a transfer opinion, a general character assessment — is UNTESTABLE.

For each POSITIONAL_ROLE claim, extract the player name, positionA (the evaluated position), and optionally positionB (the comparison position). Order claims by their appearance in the text starting from 1.`,
    outputSchema: ModeratorOutput,
  });

  let parsedClaims: Claim[];
  try {
    const reply = await runAttempts(
      "MODERATOR",
      AGENT_MAX_ATTEMPTS,
      () => runAgentFn(moderator, text, reviewId),
      agentContext
    );
    const parsed = ModeratorOutput.parse(JSON.parse(reply.text));
    parsedClaims = parsed.claims;
  } catch (err) {
    // the review ended: pass that on as it is, it's not the moderator's fault
    if (err instanceof ReviewStoppedError) {
      throw err;
    }
    throw new PipelineError(
      `Moderator failed: ${err instanceof Error ? err.message : String(err)}`,
      "moderator"
    );
  }

  // let the caller know the claims (outside the try so its errors aren't blamed on the moderator)
  if (onClaimsExtracted) {
    await onClaimsExtracted(parsedClaims);
  }

  // search loop: code runs one search per checkable claim, the model never decides this.
  // labels count per run, so two reviews running at once each get their own E1, E2, ...
  const evidenceEntries: EvidenceEntry[] = [];
  let labelCounter = 0;

  // testable claims past the search limit are never searched
  const notChecked = claimsOverSearchLimit(parsedClaims);

  for (const claim of parsedClaims) {
    if (claim.type !== "POSITIONAL_ROLE") continue;
    if (notChecked.has(claim.order)) continue;

    const query = buildSearchQuery(claim);
    const args = { claimOrder: claim.order, query };

    let sources: WebSource[] = [];
    let searchError: string | null = null;

    const searchContext: AttemptContext = { ...agentContext, claimOrder: claim.order };
    try {
      const reply = await runAttempts("SEARCH", SEARCH_MAX_ATTEMPTS, () => searchWebFn(query), searchContext);
      sources = reply.sources;
    } catch (err) {
      // the review ended: stop the whole pipeline, don't save it as a failed search
      if (err instanceof ReviewStoppedError) {
        throw err;
      }
      searchError = errorMessage(err);
    }

    if (searchError !== null || sources.length === 0) {
      // always one row per search, even on failure, so the check below can see it
      labelCounter++;
      evidenceEntries.push({
        label: `E${labelCounter}`,
        toolName: "searchWeb",
        args,
        result: {},
        kind: "WEB",
        sourceUrl: null,
        sourceTitle: null,
        publishedAt: null,
        error: searchError ?? NO_SOURCES_ERROR,
      });
    } else {
      // one evidence row per source the search returned
      for (const source of sources) {
        labelCounter++;
        evidenceEntries.push({
          label: `E${labelCounter}`,
          toolName: "searchWeb",
          args,
          result: { url: source.url, title: source.title },
          kind: "WEB",
          sourceUrl: source.url,
          sourceTitle: source.title,
          publishedAt: source.publishedAt,
          error: null,
        });
      }
    }
  }

  // every search threw (outage, quota) -> fail the review so it can be retried,
  // instead of stamping "check incomplete" on the debate for good
  if (everySearchThrew(evidenceEntries)) {
    const firstError = evidenceEntries[0]?.error ?? "unknown error";
    throw new PipelineError(`Every search failed: ${firstError}`, "search");
  }

  // which claims have at least one usable evidence row?
  const usableEvidence = evidenceEntries.filter((e) => e.error === null);
  const claimsWithEvidence = new Set(usableEvidence.map((e) => e.args.claimOrder));

  // fact checker: only sees claims that have usable evidence
  const testableClaims = parsedClaims.filter(
    (c) => c.type === "POSITIONAL_ROLE" && claimsWithEvidence.has(c.order)
  );

  let verdicts: FactCheckerOutput["verdicts"] = [];

  if (testableClaims.length > 0) {
    const claimsContext = testableClaims
      .map((c) => `Claim ${c.order}: "${c.claimText}"`)
      .join("\n");

    const evidenceContext = usableEvidence
      .map((e) => `${e.label} (for claim ${e.args.claimOrder}): ${e.sourceTitle ?? "untitled"} — ${e.sourceUrl}`)
      .join("\n");

    const factChecker = new LlmAgent({
      name: "fact_checker",
      model,
      instruction: `You are a football fact-checker. You are given claims and a numbered evidence list.

For each claim, give a verdict (VERIFIED, PARTIALLY_TRUE, or REFUTED) and cite only evidence labels from the list. Each label shows which claim it was gathered for — only cite a label for the claim it belongs to. Never invent evidence or cite labels not in the list.`,
      outputSchema: FactCheckerOutput,
    });

    const factCheckerInput = `Claims:\n${claimsContext}\n\nEvidence:\n${evidenceContext}`;

    try {
      const reply = await runAttempts(
        "FACT_CHECKER",
        AGENT_MAX_ATTEMPTS,
        () => runAgentFn(factChecker, factCheckerInput, reviewId),
        agentContext
      );
      const parsed = FactCheckerOutput.parse(JSON.parse(reply.text));
      verdicts = parsed.verdicts;
    } catch (err) {
      if (err instanceof ReviewStoppedError) {
        throw err;
      }
      throw new PipelineError(
        `Fact Checker failed: ${err instanceof Error ? err.message : String(err)}`,
        "fact_checker"
      );
    }
  }

  // build the final claim results, checking every citation
  const verdictMap = new Map(verdicts.map((v) => [v.claimOrder, v]));

  const evidenceRecords: EvidenceRecord[] = evidenceEntries.map((e) => ({
    label: e.label,
    args: e.args,
    error: e.error,
  }));

  const claimResults: ClaimResult[] = parsedClaims.map((claim) => {
    // untestable claims are never searched or judged
    if (claim.type === "UNTESTABLE") {
      return {
        order: claim.order,
        claimText: claim.claimText,
        entities: claim.entities,
        type: "UNTESTABLE",
        verdict: "UNTESTABLE",
        reasoning: null,
        citedLabels: [],
        confidence: null,
      };
    }

    // past the search limit: never searched, so no evidence and no verdict
    if (notChecked.has(claim.order)) {
      return {
        order: claim.order,
        claimText: claim.claimText,
        entities: claim.entities,
        type: "POSITIONAL_ROLE",
        verdict: "INSUFFICIENT_DATA",
        reasoning: NOT_CHECKED_REASONING,
        citedLabels: [],
        confidence: null,
      };
    }

    // no usable evidence, the fact checker never saw this claim
    if (!claimsWithEvidence.has(claim.order)) {
      return {
        order: claim.order,
        claimText: claim.claimText,
        entities: claim.entities,
        type: "POSITIONAL_ROLE",
        verdict: "INSUFFICIENT_DATA",
        reasoning: "No usable evidence was found for this claim.",
        citedLabels: [],
        confidence: null,
      };
    }

    // the fact checker left this claim out of its answer
    const verdict = verdictMap.get(claim.order);
    if (!verdict) {
      return {
        order: claim.order,
        claimText: claim.claimText,
        entities: claim.entities,
        type: "POSITIONAL_ROLE",
        verdict: "INSUFFICIENT_DATA",
        reasoning: "The Fact Checker did not return a verdict for this claim.",
        citedLabels: [],
        confidence: null,
      };
    }

    // every cited label must exist and belong to this claim, or the verdict is thrown out
    const citationCheck = validateCitations(verdict.citedLabels, claim.order, evidenceRecords);
    if (!citationCheck.ok) {
      const detail =
        citationCheck.invalidLabels.length > 0
          ? `invalid labels: ${citationCheck.invalidLabels.join(", ")}`
          : "zero labels cited";
      return {
        order: claim.order,
        claimText: claim.claimText,
        entities: claim.entities,
        type: "POSITIONAL_ROLE",
        verdict: "INSUFFICIENT_DATA",
        reasoning: `Citation check failed (${detail}).`,
        citedLabels: [],
        confidence: null,
      };
    }

    // Confidence: number of distinct hostnames among cited, usable rows.
    // Two or more independent sources → 0.8; one → 0.4.
    const citedUsable = usableEvidence.filter(
      (e) => citationCheck.validLabels.includes(e.label) && e.args.claimOrder === claim.order
    );
    const distinctHosts = new Set(citedUsable.map(sourceSite));
    const confidence = citedUsable.length === 0 ? null : distinctHosts.size >= 2 ? 0.8 : 0.4;

    return {
      order: claim.order,
      claimText: claim.claimText,
      entities: claim.entities,
      type: "POSITIONAL_ROLE",
      verdict: verdict.verdict,
      reasoning: verdict.reasoning,
      citedLabels: citationCheck.validLabels,
      confidence,
    };
  });

  const score = computeScore(claimResults);
  const decision = computeDecision(score);

  return { claims: claimResults, evidence: evidenceEntries, score, decision };
}
