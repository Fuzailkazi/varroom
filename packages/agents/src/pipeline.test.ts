import { expect, test, describe } from "bun:test";
import { runPipeline } from "./pipeline.ts";
import { PipelineError } from "./types.ts";
import type { RunAgentFn, SearchWebFn, EvidenceEntry } from "./pipeline.ts";
import type { LlmAgent } from "@google/adk";
import type { WebSource } from "./search.ts";

// Fake agent runner: returns predefined JSON based on which agent is running.
// We distinguish moderator from fact_checker by checking whether the input
// starts with "Claims:" — the pipeline always builds the fact checker prompt
// that way.
function makeRunAgentFn(
  moderatorOutput: object,
  factCheckerOutput: object
): RunAgentFn {
  return async (_agent: LlmAgent, input: string) => {
    if (input.startsWith("Claims:")) {
      return JSON.stringify(factCheckerOutput);
    }
    return JSON.stringify(moderatorOutput);
  };
}

// Fake search: returns the given sources for every query.
function makeSearchFn(sources: WebSource[]): SearchWebFn {
  return async () => sources;
}

// Fake search that throws.
function makeFailingSearchFn(message: string): SearchWebFn {
  return async () => {
    throw new Error(message);
  };
}

describe("runPipeline — happy path", () => {
  test("one POSITIONAL_ROLE claim produces a VERIFIED verdict and a score", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Bellingham is better as a false 9 than as an 8",
          type: "POSITIONAL_ROLE",
          entities: { player: "Bellingham", positionA: "false 9", positionB: "8" },
        },
      ],
    };
    const factChecker = {
      verdicts: [
        {
          claimOrder: 1,
          verdict: "VERIFIED",
          reasoning: "Multiple stats sources confirm higher goal contributions as a 9.",
          citedLabels: ["E1"],
        },
      ],
    };

    const result = await runPipeline("Bellingham is better as a false 9 than as an 8", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: makeSearchFn([
        { url: "https://example.com/stats", title: "Bellingham stats", publishedAt: null },
      ]),
    });

    expect(result.claims).toHaveLength(1);
    const claim = result.claims.at(0);
    expect(claim?.verdict).toBe("VERIFIED");
    expect(claim?.citedLabels).toEqual(["E1"]);
    expect(result.score).toBe(100);
    expect(result.decision).toBe("CONFIRMED");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence.at(0)?.label).toBe("E1");
    expect(result.evidence.at(0)?.error).toBeNull();
  });

  test("two independent sources give confidence 0.8", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Messi is better as a false 9 than as a winger",
          type: "POSITIONAL_ROLE",
          entities: { player: "Messi", positionA: "false 9", positionB: "winger" },
        },
      ],
    };
    const factChecker = {
      verdicts: [
        {
          claimOrder: 1,
          verdict: "PARTIALLY_TRUE",
          reasoning: "Stats support it in recent seasons.",
          citedLabels: ["E1", "E2"],
        },
      ],
    };

    const result = await runPipeline("Messi is better as a false 9 than as a winger", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: makeSearchFn([
        { url: "https://siteA.com/messi", title: "Site A", publishedAt: null },
        { url: "https://siteB.com/messi", title: "Site B", publishedAt: null },
      ]),
    });

    expect(result.claims.at(0)?.confidence).toBe(0.8);
  });

  test("Google redirect links from two different sites still count as two sources", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Messi is better as a false 9 than as a winger",
          type: "POSITIONAL_ROLE",
          entities: { player: "Messi", positionA: "false 9", positionB: "winger" },
        },
      ],
    };
    const factChecker = {
      verdicts: [
        {
          claimOrder: 1,
          verdict: "VERIFIED",
          reasoning: "Two sites agree.",
          citedLabels: ["E1", "E2"],
        },
      ],
    };

    // Real Gemini grounding: every URL is a redirect on the same Google host,
    // and the title holds the real site's domain.
    const result = await runPipeline("Messi is better as a false 9 than as a winger", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: makeSearchFn([
        {
          url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/aaa",
          title: "wikipedia.org",
          publishedAt: null,
        },
        {
          url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/bbb",
          title: "bundesliga.com",
          publishedAt: null,
        },
      ]),
    });

    expect(result.claims.at(0)?.confidence).toBe(0.8);
  });

  test("one source gives confidence 0.4", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Messi is better as a false 9",
          type: "POSITIONAL_ROLE",
          entities: { player: "Messi", positionA: "false 9" },
        },
      ],
    };
    const factChecker = {
      verdicts: [
        {
          claimOrder: 1,
          verdict: "VERIFIED",
          reasoning: "One source confirms it.",
          citedLabels: ["E1"],
        },
      ],
    };

    const result = await runPipeline("Messi is better as a false 9", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: makeSearchFn([
        { url: "https://siteA.com/messi", title: "Site A", publishedAt: null },
      ]),
    });

    expect(result.claims.at(0)?.confidence).toBe(0.4);
  });
});

describe("runPipeline — citation validation", () => {
  test("citing a label from a different claim downgrades to INSUFFICIENT_DATA", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Claim A",
          type: "POSITIONAL_ROLE",
          entities: { player: "Player A", positionA: "9" },
        },
        {
          order: 2,
          claimText: "Claim B",
          type: "POSITIONAL_ROLE",
          entities: { player: "Player B", positionA: "8" },
        },
      ],
    };
    // Fact Checker cites E2 (belongs to claim 2) when judging claim 1.
    const factChecker = {
      verdicts: [
        {
          claimOrder: 1,
          verdict: "VERIFIED",
          reasoning: "Cross-claim borrowing.",
          citedLabels: ["E2"],
        },
        {
          claimOrder: 2,
          verdict: "VERIFIED",
          reasoning: "Own evidence cited.",
          citedLabels: ["E2"],
        },
      ],
    };

    const result = await runPipeline("Claim A. Claim B.", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: makeSearchFn([
        { url: "https://siteA.com", title: "Source for claim", publishedAt: null },
      ]),
    });

    // Claim 1 cited E2 which belongs to claim 2 → INSUFFICIENT_DATA
    const claim1 = result.claims.find((c) => c.order === 1);
    expect(claim1?.verdict).toBe("INSUFFICIENT_DATA");
    expect(claim1?.citedLabels).toEqual([]);

    // Claim 2 cited E2 which belongs to claim 2 → its own evidence, valid
    const claim2 = result.claims.find((c) => c.order === 2);
    expect(claim2?.verdict).toBe("VERIFIED");
  });

  test("citing zero labels downgrades to INSUFFICIENT_DATA", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Claim A",
          type: "POSITIONAL_ROLE",
          entities: { player: "Player A", positionA: "9" },
        },
      ],
    };
    const factChecker = {
      verdicts: [
        {
          claimOrder: 1,
          verdict: "VERIFIED",
          reasoning: "No citations.",
          citedLabels: [],
        },
      ],
    };

    const result = await runPipeline("Claim A", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: makeSearchFn([
        { url: "https://siteA.com", title: "Source", publishedAt: null },
      ]),
    });

    expect(result.claims.at(0)?.verdict).toBe("INSUFFICIENT_DATA");
  });

  test("omitting a claim from verdicts downgrades it to INSUFFICIENT_DATA", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Claim A",
          type: "POSITIONAL_ROLE",
          entities: { player: "Player A", positionA: "9" },
        },
      ],
    };
    // Fact Checker returns empty verdicts list.
    const factChecker = { verdicts: [] };

    const result = await runPipeline("Claim A", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: makeSearchFn([
        { url: "https://siteA.com", title: "Source", publishedAt: null },
      ]),
    });

    expect(result.claims.at(0)?.verdict).toBe("INSUFFICIENT_DATA");
  });
});

describe("runPipeline — search failure", () => {
  test("when every search fails, the whole run fails at the search step so it can be retried", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Bellingham as a 9",
          type: "POSITIONAL_ROLE",
          entities: { player: "Bellingham", positionA: "9" },
        },
      ],
    };

    let thrown: unknown = null;
    try {
      await runPipeline("Bellingham as a 9", {
        runAgentFn: makeRunAgentFn(moderator, { verdicts: [] }),
        searchWebFn: makeFailingSearchFn("Search API unreachable"),
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PipelineError);
    const pipelineError = thrown as PipelineError;
    expect(pipelineError.step).toBe("search");
    expect(pipelineError.message).toContain("Search API unreachable");
  });

  test("when only some searches fail, the run goes on and just that claim can't be checked", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Player A is better as a 9 than an 8",
          type: "POSITIONAL_ROLE",
          entities: { player: "Player A", positionA: "9", positionB: "8" },
        },
        {
          order: 2,
          claimText: "Player B is better as a 10 than a winger",
          type: "POSITIONAL_ROLE",
          entities: { player: "Player B", positionA: "10", positionB: "winger" },
        },
      ],
    };
    const factChecker = {
      verdicts: [{ claimOrder: 2, verdict: "VERIFIED", reasoning: "Found it.", citedLabels: ["E2"] }],
    };

    // first search throws, second one works
    let calls = 0;
    const flakySearch: SearchWebFn = async () => {
      calls++;
      if (calls === 1) {
        throw new Error("Search API unreachable");
      }
      return [{ url: "https://site.com/b", title: "site.com", publishedAt: null }];
    };

    const result = await runPipeline("two claims", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: flakySearch,
    });

    expect(result.evidence.at(0)?.error).toBe("Search API unreachable");
    expect(result.claims.at(0)?.verdict).toBe("INSUFFICIENT_DATA");
    expect(result.claims.at(1)?.verdict).toBe("VERIFIED");
  });

  test("empty search results also produce an error evidence row", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Bellingham as a 9",
          type: "POSITIONAL_ROLE",
          entities: { player: "Bellingham", positionA: "9" },
        },
      ],
    };

    const result = await runPipeline("Bellingham as a 9", {
      runAgentFn: makeRunAgentFn(moderator, { verdicts: [] }),
      searchWebFn: makeSearchFn([]),
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence.at(0)?.error).toBe("No sources returned");
    expect(result.claims.at(0)?.verdict).toBe("INSUFFICIENT_DATA");
  });
});

describe("runPipeline — UNTESTABLE claims", () => {
  test("UNTESTABLE claims are excluded from the score and never searched", async () => {
    let searchCallCount = 0;
    const countingSearch: SearchWebFn = async () => {
      searchCallCount++;
      return [{ url: "https://example.com", title: "Example", publishedAt: null }];
    };

    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Bellingham is better as a false 9 than as an 8",
          type: "POSITIONAL_ROLE",
          entities: { player: "Bellingham", positionA: "false 9", positionB: "8" },
        },
        {
          order: 2,
          claimText: "Guardiola is overrated",
          type: "UNTESTABLE",
          entities: { player: "Guardiola", positionA: "" },
        },
      ],
    };
    const factChecker = {
      verdicts: [
        {
          claimOrder: 1,
          verdict: "REFUTED",
          reasoning: "Evidence shows otherwise.",
          citedLabels: ["E1"],
        },
      ],
    };

    const result = await runPipeline("Bellingham as 9. Guardiola overrated.", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: countingSearch,
    });

    // Only the POSITIONAL_ROLE claim triggered a search.
    expect(searchCallCount).toBe(1);

    // The UNTESTABLE claim appears in output but with UNTESTABLE verdict.
    const untestable = result.claims.find((c) => c.order === 2)!;
    expect(untestable.verdict).toBe("UNTESTABLE");
    expect(untestable.confidence).toBeNull();

    // Score is computed only from the POSITIONAL_ROLE claim (REFUTED → 0).
    expect(result.score).toBe(0);
    expect(result.decision).toBe("OVERTURNED");
  });
});

describe("runPipeline — score edge cases", () => {
  test("zero testable claims gives null score and INCONCLUSIVE", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Guardiola is a genius",
          type: "UNTESTABLE",
          entities: { player: "Guardiola", positionA: "" },
        },
      ],
    };

    const result = await runPipeline("Guardiola is a genius", {
      runAgentFn: makeRunAgentFn(moderator, { verdicts: [] }),
      searchWebFn: makeSearchFn([]),
    });

    expect(result.score).toBeNull();
    expect(result.decision).toBe("INCONCLUSIVE");
  });

  test("one VERIFIED and one REFUTED gives score 50 and CONFIRMED", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Claim A",
          type: "POSITIONAL_ROLE",
          entities: { player: "Player A", positionA: "9" },
        },
        {
          order: 2,
          claimText: "Claim B",
          type: "POSITIONAL_ROLE",
          entities: { player: "Player B", positionA: "8" },
        },
      ],
    };
    const factChecker = {
      verdicts: [
        {
          claimOrder: 1,
          verdict: "VERIFIED",
          reasoning: "Verified.",
          citedLabels: ["E1"],
        },
        {
          claimOrder: 2,
          verdict: "REFUTED",
          reasoning: "Refuted.",
          citedLabels: ["E2"],
        },
      ],
    };

    const result = await runPipeline("Claim A. Claim B.", {
      runAgentFn: makeRunAgentFn(moderator, factChecker),
      searchWebFn: makeSearchFn([
        { url: "https://siteA.com", title: "Source A", publishedAt: null },
      ]),
    });

    expect(result.score).toBe(50);
    expect(result.decision).toBe("CONFIRMED");
  });
});

describe("runPipeline — progress callback and entities", () => {
  test("calls onClaimsExtracted with the moderator's claims before searching", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Bellingham is better as a false 9 than as an 8",
          type: "POSITIONAL_ROLE",
          entities: { player: "Bellingham", positionA: "false 9", positionB: "8" },
        },
      ],
    };

    const steps: string[] = [];
    let claimsSeen = 0;
    const recordingSearch: SearchWebFn = async () => {
      steps.push("search");
      return [{ url: "https://site.com/a", title: "site.com", publishedAt: null }];
    };

    await runPipeline("text", {
      runAgentFn: makeRunAgentFn(moderator, { verdicts: [] }),
      searchWebFn: recordingSearch,
      onClaimsExtracted: async (claims) => {
        steps.push("claims");
        claimsSeen = claims.length;
      },
    });

    expect(steps).toEqual(["claims", "search"]);
    expect(claimsSeen).toBe(1);
  });

  test("keeps the moderator's player and positions on each claim result", async () => {
    const moderator = {
      claims: [
        {
          order: 1,
          claimText: "Bellingham is better as a false 9 than as an 8",
          type: "POSITIONAL_ROLE",
          entities: { player: "Bellingham", positionA: "false 9", positionB: "8" },
        },
      ],
    };

    const result = await runPipeline("text", {
      runAgentFn: makeRunAgentFn(moderator, { verdicts: [] }),
      searchWebFn: makeSearchFn([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]),
    });

    expect(result.claims.at(0)?.entities).toEqual({ player: "Bellingham", positionA: "false 9", positionB: "8" });
  });
});
