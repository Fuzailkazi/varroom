import type { GenerateContentResponseUsageMetadata } from "@google/genai";
import type { TokenUsage } from "./types.ts";

// turns gemini's usage metadata into our token counts.
// null when gemini sent no usage at all. a missing count is 0
export function toTokenUsage(metadata: GenerateContentResponseUsageMetadata | undefined): TokenUsage | null {
  if (!metadata) {
    return null;
  }

  // input = the prompt, plus the extra prompt gemini builds when it runs a tool (e.g. google search)
  let inputTokens = metadata.promptTokenCount ?? 0;
  if (metadata.toolUsePromptTokenCount) {
    inputTokens = inputTokens + metadata.toolUsePromptTokenCount;
  }

  return {
    inputTokens: inputTokens,
    outputTokens: metadata.candidatesTokenCount ?? 0,
    thinkingTokens: metadata.thoughtsTokenCount ?? 0,
  };
}
