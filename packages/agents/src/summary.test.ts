import { describe, expect, test } from "bun:test";
import { buildSummary } from "./summary.ts";
import type { ClaimResult } from "./types.ts";

// buildSummary is pure, plain unit tests

function claimWith(verdict: ClaimResult["verdict"]): ClaimResult {
  return {
    order: 1,
    claimText: "a claim",
    entities: { player: "Player", positionA: "9" },
    type: "POSITIONAL_ROLE",
    verdict: verdict,
    reasoning: null,
    citedLabels: [],
    confidence: null,
  };
}

describe("buildSummary", () => {
  test("counts each verdict in a fixed order", () => {
    const summary = buildSummary([claimWith("REFUTED"), claimWith("VERIFIED"), claimWith("INSUFFICIENT_DATA")]);

    expect(summary).toBe("3 claims: 1 stands, 1 overturned, 1 couldn't be checked");
  });

  test("leaves out verdicts that have no claims", () => {
    const summary = buildSummary([claimWith("VERIFIED"), claimWith("VERIFIED")]);

    expect(summary).toBe("2 claims: 2 stands");
  });

  test("says claim, not claims, when there is only one", () => {
    const summary = buildSummary([claimWith("UNTESTABLE")]);

    expect(summary).toBe("1 claim: 1 not testable");
  });

  test("covers partly stands too", () => {
    const summary = buildSummary([claimWith("PARTIALLY_TRUE")]);

    expect(summary).toBe("1 claim: 1 partly stands");
  });

  test("handles a review with no claims at all", () => {
    expect(buildSummary([])).toBe("0 claims");
  });
});
