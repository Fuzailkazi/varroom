import { LlmAgent, InMemoryRunner, isFinalResponse, stringifyContent } from "@google/adk";
import { ModeratorOutput, FactCheckerOutput, PipelineError, DEFAULT_GEMINI_MODEL } from "./types.ts";
import type { Claim, ClaimResult, ReviewResult, EvidenceKind } from "./types.ts";
import { validateCitations } from "./citations.ts";
import type { EvidenceRecord } from "./citations.ts";
import { computeScore, computeDecision } from "./score.ts";
import { searchWeb as realSearchWeb } from "./search.ts";
import type { WebSource } from "./search.ts";

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

export type SearchWebFn = (query: string) => Promise<WebSource[]>;

// An agent runner function — injectable so unit tests can replace it with
// a fake that returns fixed JSON without making real Gemini calls.
export type RunAgentFn = (agent: LlmAgent, input: string) => Promise<string>;

export type PipelineOutput = {
  claims: ClaimResult[];
  evidence: EvidenceEntry[];
  score: number | null;
  decision: ReviewResult["decision"];
};

export type PipelineOptions = {
  searchWebFn?: SearchWebFn;
  runAgentFn?: RunAgentFn;
};

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

// Builds a grounded search query from a claim's extracted entities.
function buildSearchQuery(claim: Claim): string {
  const { player, positionA, positionB } = claim.entities;
  return positionB
    ? `${player} ${positionA} vs ${positionB} stats`
    : `${player} ${positionA} stats`;
}

// Runs the agent once and returns the model's final text.
// ADK does not throw when Gemini fails: it puts the error on the event
// (errorCode / errorMessage) with no content, so we check for it ourselves.
async function runAgentOnce(agent: LlmAgent, input: string): Promise<string> {
  const runner = new InMemoryRunner({ agent, appName: "varroom" });

  for await (const event of runner.runEphemeral({
    userId: "pipeline",
    newMessage: { parts: [{ text: input }] },
  })) {
    if (event.errorMessage) {
      throw new Error(`Gemini error ${event.errorCode ?? ""}: ${event.errorMessage}`);
    }
    if (isFinalResponse(event)) {
      return stringifyContent(event);
    }
  }
  throw new Error("The model finished without a final response");
}

// Gemini sometimes answers "high demand, try again later" (503) or
// "too many requests" (429). Those are worth retrying; anything else is not.
function isTemporaryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /503|429|high demand|overloaded|try again/i.test(message);
}

// Runs a single LlmAgent call, retrying temporary errors up to 3 times.
// Each attempt times out after 60 seconds.
async function defaultRunAgent(agent: LlmAgent, input: string): Promise<string> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await Promise.race([
        runAgentOnce(agent, input),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Agent call timed out after 60s")), 60_000)
        ),
      ]);
    } catch (err) {
      const canRetry = attempt < maxAttempts && isTemporaryError(err);
      if (!canRetry) throw err;
      // Wait 2s, then 4s, before trying again.
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw new Error("unreachable");
}

// Runs the Moderator → search loop → Fact Checker pipeline.
// Returns the typed results without touching the database.
// searchWebFn and runAgentFn are injectable for unit testing.
export async function runPipeline(
  text: string,
  { searchWebFn = realSearchWeb, runAgentFn = defaultRunAgent }: PipelineOptions = {}
): Promise<PipelineOutput> {
  const model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;

  // -- Moderator: extract claims -------------------------------------------
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
    const raw = await runAgentFn(moderator, text);
    const parsed = ModeratorOutput.parse(JSON.parse(raw));
    parsedClaims = parsed.claims;
  } catch (err) {
    throw new PipelineError(
      `Moderator failed: ${err instanceof Error ? err.message : String(err)}`,
      "moderator"
    );
  }

  // -- Search loop: one searchWeb call per POSITIONAL_ROLE claim ------------
  // The label counter is per pipeline run (not per process), so two concurrent
  // reviews of the same debate each get their own E1, E2, ... sequence.
  const evidenceEntries: EvidenceEntry[] = [];
  let labelCounter = 0;

  for (const claim of parsedClaims) {
    if (claim.type !== "POSITIONAL_ROLE") continue;

    const query = buildSearchQuery(claim);
    const args = { claimOrder: claim.order, query };

    let sources: WebSource[] = [];
    let searchError: string | null = null;

    try {
      sources = await Promise.race([
        searchWebFn(query),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Search timed out after 60s")), 60_000)
        ),
      ]);
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err);
    }

    if (searchError !== null || sources.length === 0) {
      // Spec invariant: always write at least one evidence row per search
      // call, even on failure, so the AC-5 pre-check has something to read.
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
        error: searchError ?? "No sources returned",
      });
    } else {
      // afterToolCallback: one row per source returned by the search.
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

  // -- AC-5 pre-check: which claims have at least one usable evidence row? --
  const usableEvidence = evidenceEntries.filter((e) => e.error === null);
  const claimsWithEvidence = new Set(usableEvidence.map((e) => e.args.claimOrder));

  // -- Fact Checker: only sent claims that passed the AC-5 pre-check --------
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
      const raw = await runAgentFn(factChecker, factCheckerInput);
      const parsed = FactCheckerOutput.parse(JSON.parse(raw));
      verdicts = parsed.verdicts;
    } catch (err) {
      throw new PipelineError(
        `Fact Checker failed: ${err instanceof Error ? err.message : String(err)}`,
        "fact_checker"
      );
    }
  }

  // -- Build ClaimResult[] with citation validation -------------------------
  const verdictMap = new Map(verdicts.map((v) => [v.claimOrder, v]));

  const evidenceRecords: EvidenceRecord[] = evidenceEntries.map((e) => ({
    label: e.label,
    args: e.args,
    error: e.error,
  }));

  const claimResults: ClaimResult[] = parsedClaims.map((claim) => {
    // AC-6: untestable claims are never searched or judged.
    if (claim.type === "UNTESTABLE") {
      return {
        order: claim.order,
        claimText: claim.claimText,
        type: "UNTESTABLE",
        verdict: "UNTESTABLE",
        reasoning: null,
        citedLabels: [],
        confidence: null,
      };
    }

    // AC-5: no usable evidence — skip Fact Checker for this claim.
    if (!claimsWithEvidence.has(claim.order)) {
      return {
        order: claim.order,
        claimText: claim.claimText,
        type: "POSITIONAL_ROLE",
        verdict: "INSUFFICIENT_DATA",
        reasoning: "No usable evidence was found for this claim.",
        citedLabels: [],
        confidence: null,
      };
    }

    // AC-4: Fact Checker omitted this claim from its verdicts.
    const verdict = verdictMap.get(claim.order);
    if (!verdict) {
      return {
        order: claim.order,
        claimText: claim.claimText,
        type: "POSITIONAL_ROLE",
        verdict: "INSUFFICIENT_DATA",
        reasoning: "The Fact Checker did not return a verdict for this claim.",
        citedLabels: [],
        confidence: null,
      };
    }

    // AC-3/AC-4: every cited label must exist and belong to this claim.
    const citationCheck = validateCitations(verdict.citedLabels, claim.order, evidenceRecords);
    if (!citationCheck.ok) {
      const detail =
        citationCheck.invalidLabels.length > 0
          ? `invalid labels: ${citationCheck.invalidLabels.join(", ")}`
          : "zero labels cited";
      return {
        order: claim.order,
        claimText: claim.claimText,
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
