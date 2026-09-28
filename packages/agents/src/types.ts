import { z } from "zod";

// ----- what the Moderator LLM returns -----
// The Moderator reads the debate text and splits it into claims.
// POSITIONAL_ROLE = "player X is better/worse as position A than position B"
// UNTESTABLE = anything else we cannot check right now (tactics, transfers, etc.)

export const ModeratorOutput = z.object({
  claims: z.array(
    z.object({
      order: z.number().int(), // position in the debate, 1-based
      claimText: z.string(),
      type: z.enum(["POSITIONAL_ROLE", "UNTESTABLE"]),
      entities: z.object({
        player: z.string(),
        positionA: z.string(),
        positionB: z.string().optional(), // absent for UNTESTABLE claims
      }),
    })
  ),
});

export type ModeratorOutput = z.infer<typeof ModeratorOutput>;
export type Claim = ModeratorOutput["claims"][number];

// ----- what the Fact Checker LLM returns -----
// The Fact Checker only ever returns VERIFIED / PARTIALLY_TRUE / REFUTED.
// INSUFFICIENT_DATA is set by our code, never requested from the model.

export const FactCheckerOutput = z.object({
  verdicts: z.array(
    z.object({
      claimOrder: z.number().int(), // matches Claim.order
      verdict: z.enum(["VERIFIED", "PARTIALLY_TRUE", "REFUTED"]),
      reasoning: z.string(),
      citedLabels: z.array(z.string()), // e.g. ["E1", "E3"]
    })
  ),
});

export type FactCheckerOutput = z.infer<typeof FactCheckerOutput>;
export type Verdict = FactCheckerOutput["verdicts"][number];

// ----- pipeline result returned to callers -----

// the names the moderator pulled out of a claim. empty strings for untestable ones
export type ClaimEntities = {
  player: string;
  positionA: string;
  positionB?: string;
};

export type ClaimResult = {
  order: number;
  claimText: string;
  entities: ClaimEntities;
  type: "POSITIONAL_ROLE" | "UNTESTABLE";
  verdict: "VERIFIED" | "PARTIALLY_TRUE" | "REFUTED" | "INSUFFICIENT_DATA" | "UNTESTABLE";
  reasoning: string | null;
  citedLabels: string[];
  confidence: number | null;
};

export type ReviewResult = {
  reviewId: string;
  status: "COMPLETE" | "FAILED";
  claims: ClaimResult[];
  score: number | null; // 0-100, null when zero testable claims
  decision: "CONFIRMED" | "OVERTURNED" | "INCONCLUSIVE";
  failureReason?: string;
};

// ----- error thrown by the pipeline -----
// Callers catch this and mark the review as FAILED.

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly step: "moderator" | "search" | "fact_checker" | "persist"
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

// thrown instead of starting a new gemini attempt once the review has ended (it timed
// out, or its debate was deleted). an ended review holds no daily budget any more,
// so every call it kept making would be one the budget never planned for
export class ReviewStoppedError extends Error {
  constructor() {
    super("The review already ended, so no more Gemini calls were started");
    this.name = "ReviewStoppedError";
  }
}

// ----- model -----
// Used when GEMINI_MODEL is not set. Google retires old model names
// (gemini-2.0-flash now returns 404), so keep this in one place.
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

// the gemini model reviews run on, also stored on the review row and on every ai call row
export function geminiModel(): string {
  const fromEnv = process.env.GEMINI_MODEL;
  if (fromEnv) {
    return fromEnv;
  }
  return DEFAULT_GEMINI_MODEL;
}

// ----- web search -----

// one web page the grounded search cited
export type WebSource = {
  url: string;
  title: string;
  publishedAt: Date | null;
};

// ----- token usage and call records -----

// tokens gemini reported for one call. missing counts are 0
export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
};

// what one agent attempt gives back. usage is null when gemini reported none
export type AgentReply = {
  text: string;
  usage: TokenUsage | null;
};

// what one search attempt gives back
export type SearchReply = {
  sources: WebSource[];
  usage: TokenUsage | null;
};

// one gemini attempt, success or failure. the pipeline hands one of these
// to onAiCall after every attempt, retries included
export type AiCallRecord = {
  step: "MODERATOR" | "SEARCH" | "FACT_CHECKER";
  attempt: number; // 1 based
  claimOrder: number | null; // searches only
  model: string;
  status: "OK" | "ERROR";
  error: string | null;
  usage: TokenUsage | null;
  durationMs: number;
  startedAt: Date;
};

// ----- evidence kind -----

export type EvidenceKind = "WEB" | "API";
