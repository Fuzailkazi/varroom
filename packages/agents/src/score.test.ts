import { expect, test, describe } from "bun:test";
import { computeScore, computeDecision } from "./score.ts";
import type { ClaimResult } from "./types.ts";

// helper: build a minimal ClaimResult with the given verdict
function claim(verdict: ClaimResult["verdict"]): ClaimResult {
  return {
    order: 1,
    claimText: "test claim",
    entities: { player: "Player", positionA: "9" },
    type: "POSITIONAL_ROLE",
    verdict,
    reasoning: null,
    citedLabels: [],
    confidence: null,
  };
}

describe("computeScore", () => {
  test("all VERIFIED gives 100", () => {
    expect(computeScore([claim("VERIFIED"), claim("VERIFIED")])).toBe(100);
  });

  test("all REFUTED gives 0", () => {
    expect(computeScore([claim("REFUTED"), claim("REFUTED")])).toBe(0);
  });

  test("all PARTIALLY_TRUE gives 50", () => {
    // 100 * (0 + 0.5 * 2) / (0 + 2 + 0) = 50
    expect(computeScore([claim("PARTIALLY_TRUE"), claim("PARTIALLY_TRUE")])).toBe(50);
  });

  test("one VERIFIED, one REFUTED gives 50", () => {
    // 100 * (1 + 0) / (1 + 0 + 1) = 50
    expect(computeScore([claim("VERIFIED"), claim("REFUTED")])).toBe(50);
  });

  test("two VERIFIED, one REFUTED gives 67", () => {
    // 100 * 2/3 = 66.66... rounds to 67
    expect(computeScore([claim("VERIFIED"), claim("VERIFIED"), claim("REFUTED")])).toBe(67);
  });

  test("one VERIFIED, one PARTIALLY_TRUE gives 75", () => {
    // 100 * (1 + 0.5) / 2 = 75
    expect(computeScore([claim("VERIFIED"), claim("PARTIALLY_TRUE")])).toBe(75);
  });

  test("INSUFFICIENT_DATA claims are excluded from score", () => {
    // only the VERIFIED claim counts: score is 100, not 50
    expect(
      computeScore([claim("VERIFIED"), claim("INSUFFICIENT_DATA")])
    ).toBe(100);
  });

  test("UNTESTABLE claims are excluded from score", () => {
    expect(
      computeScore([claim("REFUTED"), claim("UNTESTABLE")])
    ).toBe(0);
  });

  test("zero testable claims returns null", () => {
    expect(computeScore([])).toBeNull();
    expect(computeScore([claim("INSUFFICIENT_DATA"), claim("UNTESTABLE")])).toBeNull();
  });

  test("single PARTIALLY_TRUE gives 50", () => {
    // 100 * 0.5 / 1 = 50
    expect(computeScore([claim("PARTIALLY_TRUE")])).toBe(50);
  });
});

describe("computeDecision", () => {
  test("null score is INCONCLUSIVE", () => {
    expect(computeDecision(null)).toBe("INCONCLUSIVE");
  });

  test("score 50 is CONFIRMED (Decision stands)", () => {
    expect(computeDecision(50)).toBe("CONFIRMED");
  });

  test("score 100 is CONFIRMED", () => {
    expect(computeDecision(100)).toBe("CONFIRMED");
  });

  test("score 49 is OVERTURNED", () => {
    expect(computeDecision(49)).toBe("OVERTURNED");
  });

  test("score 0 is OVERTURNED", () => {
    expect(computeDecision(0)).toBe("OVERTURNED");
  });
});
