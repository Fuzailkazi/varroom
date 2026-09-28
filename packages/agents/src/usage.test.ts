import { describe, expect, test } from "bun:test";
import { toTokenUsage } from "./usage.ts";

// toTokenUsage is pure, so plain unit tests with made up gemini usage metadata

describe("toTokenUsage", () => {
  test("maps prompt, candidates and thoughts to input, output and thinking", () => {
    const usage = toTokenUsage({ promptTokenCount: 120, candidatesTokenCount: 45, thoughtsTokenCount: 30 });

    expect(usage).toEqual({ inputTokens: 120, outputTokens: 45, thinkingTokens: 30 });
  });

  test("adds the tool use prompt (e.g. google search) to the input", () => {
    const usage = toTokenUsage({ promptTokenCount: 100, toolUsePromptTokenCount: 250, candidatesTokenCount: 10 });

    expect(usage?.inputTokens).toBe(350);
  });

  test("counts a missing number as 0", () => {
    const usage = toTokenUsage({ candidatesTokenCount: 7 });

    expect(usage).toEqual({ inputTokens: 0, outputTokens: 7, thinkingTokens: 0 });
  });

  test("an empty usage object is all zeros", () => {
    expect(toTokenUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, thinkingTokens: 0 });
  });

  test("is null when gemini sent no usage at all", () => {
    expect(toTokenUsage(undefined)).toBeNull();
  });
});
