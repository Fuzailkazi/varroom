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

// ----- model -----
// Used when GEMINI_MODEL is not set. Google retires old model names
// (gemini-2.0-flash now returns 404), so keep this in one place.
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

// ----- evidence kind -----

export type EvidenceKind = "WEB" | "API";
