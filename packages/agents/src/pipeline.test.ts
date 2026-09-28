import { expect, test, describe } from "bun:test";
import { createEvent } from "@google/adk";
import type { Event } from "@google/adk";
import { readAgentEvents, runAttempts, runPipeline } from "./pipeline.ts";
import type { AttemptContext } from "./pipeline.ts";
import { PipelineError, ReviewStoppedError } from "./types.ts";
import type { RunAgentFn, SearchWebFn, EvidenceEntry } from "./pipeline.ts";
import type { LlmAgent } from "@google/adk";
import type { AgentReply, AiCallRecord, SearchReply, TokenUsage, WebSource } from "./types.ts";

// builds what one fake agent attempt returns: the json as text, plus optional token usage
function reply(json: object, usage: TokenUsage | null = null): AgentReply {
  return { text: JSON.stringify(json), usage: usage };
}

// builds what one fake search attempt returns
function found(sources: WebSource[], usage: TokenUsage | null = null): SearchReply {
  return { sources: sources, usage: usage };
}

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
      return reply(factCheckerOutput);
    }
    return reply(moderatorOutput);
  };
}

// Fake search: returns the given sources for every query.
function makeSearchFn(sources: WebSource[]): SearchWebFn {
  return async () => found(sources);
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
      return found([{ url: "https://site.com/b", title: "site.com", publishedAt: null }]);
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
      return found([{ url: "https://example.com", title: "Example", publishedAt: null }]);
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
      return found([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]);
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

// ----- call recording, retries and the claim limit -----

// a POSITIONAL_ROLE claim with the given order, for tests that need many
function testableClaim(order: number) {
  return {
    order: order,
    claimText: `Player ${order} is better as a 9 than an 8`,
    type: "POSITIONAL_ROLE",
    entities: { player: `Player ${order}`, positionA: "9", positionB: "8" },
  };
}

// collects every call the pipeline reports, so a test can check them afterwards
function makeCallLog(): { calls: AiCallRecord[]; onAiCall: (record: AiCallRecord) => Promise<void> } {
  const calls: AiCallRecord[] = [];
  return {
    calls: calls,
    onAiCall: async (record) => {
      calls.push(record);
    },
  };
}

// the step, attempt, claim and status of each call, easy to compare in one go
function callSummary(calls: AiCallRecord[]): string[] {
  const lines: string[] = [];
  for (const call of calls) {
    lines.push(`${call.step} #${call.attempt} claim=${call.claimOrder} ${call.status}`);
  }
  return lines;
}

// a search that throws each message in turn, then finds one source
function makeSearchThatFailsFirst(messages: string[]): SearchWebFn {
  let calls = 0;
  return async () => {
    calls++;
    const message = messages[calls - 1];
    if (message !== undefined) {
      throw new Error(message);
    }
    return found([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]);
  };
}

const oneClaim = { claims: [testableClaim(1)] };
const oneVerified = {
  verdicts: [{ claimOrder: 1, verdict: "VERIFIED", reasoning: "Found it.", citedLabels: ["E1"] }],
};

describe("runPipeline — recording every gemini call", () => {
  test("reports one call per step with its tokens, the search with its claim order", async () => {
    const moderatorUsage = { inputTokens: 100, outputTokens: 20, thinkingTokens: 5 };
    const searchUsage = { inputTokens: 30, outputTokens: 40, thinkingTokens: 0 };
    const factCheckerUsage = { inputTokens: 200, outputTokens: 50, thinkingTokens: 10 };

    const agents: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        return reply(oneVerified, factCheckerUsage);
      }
      return reply(oneClaim, moderatorUsage);
    };
    const search: SearchWebFn = async () => {
      return found([{ url: "https://site.com/a", title: "site.com", publishedAt: null }], searchUsage);
    };
    const log = makeCallLog();

    await runPipeline("text", { runAgentFn: agents, searchWebFn: search, onAiCall: log.onAiCall });

    expect(callSummary(log.calls)).toEqual([
      "MODERATOR #1 claim=null OK",
      "SEARCH #1 claim=1 OK",
      "FACT_CHECKER #1 claim=null OK",
    ]);
    expect(log.calls[0]?.usage).toEqual(moderatorUsage);
    expect(log.calls[1]?.usage).toEqual(searchUsage);
    expect(log.calls[2]?.usage).toEqual(factCheckerUsage);
    for (const call of log.calls) {
      expect(call.error).toBeNull();
      expect(call.model).toBe(process.env.GEMINI_MODEL || "gemini-2.5-flash");
      expect(call.durationMs).toBeGreaterThanOrEqual(0);
      expect(call.startedAt).toBeInstanceOf(Date);
    }
  });

  test("a call with no usage from gemini is reported with usage null", async () => {
    const log = makeCallLog();

    await runPipeline("text", {
      runAgentFn: makeRunAgentFn(oneClaim, oneVerified),
      searchWebFn: makeSearchFn([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]),
      onAiCall: log.onAiCall,
    });

    expect(log.calls).toHaveLength(3);
    for (const call of log.calls) {
      expect(call.usage).toBeNull();
    }
  });

  test("the model on each call follows GEMINI_MODEL", async () => {
    const saved = process.env.GEMINI_MODEL;
    process.env.GEMINI_MODEL = "some-test-model";
    const log = makeCallLog();
    try {
      await runPipeline("text", {
        runAgentFn: makeRunAgentFn({ claims: [] }, { verdicts: [] }),
        onAiCall: log.onAiCall,
      });
    } finally {
      if (saved === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = saved;
    }

    expect(log.calls[0]?.model).toBe("some-test-model");
  });
});

describe("runPipeline — retries", () => {
  test("a search that fails once with a 503 is tried again, and both attempts are reported", async () => {
    const log = makeCallLog();

    const result = await runPipeline("text", {
      runAgentFn: makeRunAgentFn(oneClaim, oneVerified),
      searchWebFn: makeSearchThatFailsFirst(["Gemini error 503: high demand"]),
      onAiCall: log.onAiCall,
      retryDelayMs: 0,
    });

    expect(callSummary(log.calls)).toEqual([
      "MODERATOR #1 claim=null OK",
      "SEARCH #1 claim=1 ERROR",
      "SEARCH #2 claim=1 OK",
      "FACT_CHECKER #1 claim=null OK",
    ]);
    expect(log.calls[1]?.error).toBe("Gemini error 503: high demand");
    expect(log.calls[1]?.usage).toBeNull();
    // the retry worked, so the claim was checked as usual
    expect(result.claims.at(0)?.verdict).toBe("VERIFIED");
  });

  test("a search that fails twice gives up after 2 attempts", async () => {
    const log = makeCallLog();

    let thrown: unknown = null;
    try {
      await runPipeline("text", {
        runAgentFn: makeRunAgentFn(oneClaim, oneVerified),
        searchWebFn: makeSearchThatFailsFirst(["Gemini error 503", "Gemini error 503", "Gemini error 503"]),
        onAiCall: log.onAiCall,
        retryDelayMs: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(callSummary(log.calls)).toEqual([
      "MODERATOR #1 claim=null OK",
      "SEARCH #1 claim=1 ERROR",
      "SEARCH #2 claim=1 ERROR",
    ]);
    // the only search failed, so the whole run fails at the search step
    expect(thrown).toBeInstanceOf(PipelineError);
    expect((thrown as PipelineError).step).toBe("search");
  });

  test("the moderator keeps 3 attempts for temporary errors", async () => {
    let moderatorCalls = 0;
    const agents: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        return reply(oneVerified);
      }
      moderatorCalls++;
      if (moderatorCalls < 3) {
        throw new Error("Gemini error 429: too many requests");
      }
      return reply(oneClaim);
    };
    const log = makeCallLog();

    await runPipeline("text", {
      runAgentFn: agents,
      searchWebFn: makeSearchFn([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]),
      onAiCall: log.onAiCall,
      retryDelayMs: 0,
    });

    expect(callSummary(log.calls).slice(0, 3)).toEqual([
      "MODERATOR #1 claim=null ERROR",
      "MODERATOR #2 claim=null ERROR",
      "MODERATOR #3 claim=null OK",
    ]);
  });

  test("the fact checker gives up after 3 temporary errors and the run fails at its step", async () => {
    const agents: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        throw new Error("The model is overloaded");
      }
      return reply(oneClaim);
    };
    const log = makeCallLog();

    let thrown: unknown = null;
    try {
      await runPipeline("text", {
        runAgentFn: agents,
        searchWebFn: makeSearchFn([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]),
        onAiCall: log.onAiCall,
        retryDelayMs: 0,
      });
    } catch (err) {
      thrown = err;
    }

    expect(callSummary(log.calls)).toEqual([
      "MODERATOR #1 claim=null OK",
      "SEARCH #1 claim=1 OK",
      "FACT_CHECKER #1 claim=null ERROR",
      "FACT_CHECKER #2 claim=null ERROR",
      "FACT_CHECKER #3 claim=null ERROR",
    ]);
    expect((thrown as PipelineError).step).toBe("fact_checker");
  });

  test("an error a retry won't fix is not retried", async () => {
    const log = makeCallLog();

    const result = await runPipeline("text", {
      runAgentFn: makeRunAgentFn({ claims: [testableClaim(1), testableClaim(2)] }, { verdicts: [] }),
      searchWebFn: makeSearchThatFailsFirst(["Search API unreachable"]),
      onAiCall: log.onAiCall,
      retryDelayMs: 0,
    });

    // claim 1's search failed once and stopped there, claim 2's worked
    expect(callSummary(log.calls).slice(1, 3)).toEqual(["SEARCH #1 claim=1 ERROR", "SEARCH #1 claim=2 OK"]);
    expect(result.evidence.at(0)?.error).toBe("Search API unreachable");
  });

  test("a broken moderator answer is still one OK call, since gemini itself answered", async () => {
    const log = makeCallLog();
    const brokenModerator: RunAgentFn = async () => ({ text: "not json", usage: null });

    await expect(
      runPipeline("text", { runAgentFn: brokenModerator, onAiCall: log.onAiCall, retryDelayMs: 0 })
    ).rejects.toBeInstanceOf(PipelineError);

    expect(callSummary(log.calls)).toEqual(["MODERATOR #1 claim=null OK"]);
  });
});

describe("runPipeline — stopping once the review has ended", () => {
  test("a review that ends during the moderator makes no search or fact checker call", async () => {
    const log = makeCallLog();
    let ended = false;
    const agents: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        return reply(oneVerified);
      }
      ended = true; // e.g. the review timed out while the moderator was thinking
      return reply(oneClaim);
    };
    let searches = 0;
    const search: SearchWebFn = async () => {
      searches++;
      return found([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]);
    };

    let thrown: unknown = null;
    try {
      await runPipeline("text", {
        runAgentFn: agents,
        searchWebFn: search,
        onAiCall: log.onAiCall,
        shouldStop: () => ended,
      });
    } catch (err) {
      thrown = err;
    }

    // the stop comes through as it is, not as a failed search
    expect(thrown).toBeInstanceOf(ReviewStoppedError);
    expect(searches).toBe(0);
    expect(callSummary(log.calls)).toEqual(["MODERATOR #1 claim=null OK"]);
  });

  test("a review that ends between searches starts no more searches and no fact checker", async () => {
    const log = makeCallLog();
    let searches = 0;
    const search: SearchWebFn = async () => {
      searches++;
      return found([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]);
    };

    let thrown: unknown = null;
    try {
      await runPipeline("text", {
        runAgentFn: makeRunAgentFn({ claims: [testableClaim(1), testableClaim(2)] }, oneVerified),
        searchWebFn: search,
        onAiCall: log.onAiCall,
        shouldStop: () => searches >= 1,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ReviewStoppedError);
    expect(callSummary(log.calls)).toEqual(["MODERATOR #1 claim=null OK", "SEARCH #1 claim=1 OK"]);
  });
});

describe("runPipeline — at most 5 claims are searched", () => {
  test("7 testable claims: the first 5 are searched, 6 and 7 are left unchecked", async () => {
    // an untestable claim in the middle doesn't use up the limit
    const untestable = {
      order: 3,
      claimText: "Guardiola is overrated",
      type: "UNTESTABLE",
      entities: { player: "Guardiola", positionA: "" },
    };
    const claims = [
      testableClaim(1),
      testableClaim(2),
      untestable,
      testableClaim(4),
      testableClaim(5),
      testableClaim(6),
      testableClaim(7),
      testableClaim(8),
    ];

    const searchedQueries: string[] = [];
    const search: SearchWebFn = async (query) => {
      searchedQueries.push(query);
      return found([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]);
    };
    let factCheckerInput = "";
    const agents: RunAgentFn = async (_agent, input) => {
      if (input.startsWith("Claims:")) {
        factCheckerInput = input;
        return reply({ verdicts: [] });
      }
      return reply({ claims: claims });
    };
    const log = makeCallLog();

    const result = await runPipeline("text", { runAgentFn: agents, searchWebFn: search, onAiCall: log.onAiCall });

    // claims 1, 2, 4, 5 and 6 are the first 5 testable ones
    expect(searchedQueries).toHaveLength(5);
    const searchedClaims: (number | null)[] = [];
    for (const call of log.calls) {
      if (call.step === "SEARCH") {
        searchedClaims.push(call.claimOrder);
      }
    }
    expect(searchedClaims).toEqual([1, 2, 4, 5, 6]);

    // 7 and 8 get the fixed reasoning, no evidence, and never reach the fact checker
    for (const order of [7, 8]) {
      const claim = result.claims.find((c) => c.order === order);
      expect(claim?.verdict).toBe("INSUFFICIENT_DATA");
      expect(claim?.reasoning).toBe("Not checked: a review checks at most 5 claims.");
      expect(claim?.citedLabels).toEqual([]);
      expect(claim?.confidence).toBeNull();

      const evidenceForClaim = result.evidence.filter((e) => e.args.claimOrder === order);
      expect(evidenceForClaim).toEqual([]);
      expect(factCheckerInput).not.toContain(`Claim ${order}:`);
    }
    expect(factCheckerInput).toContain("Claim 6:");
    expect(result.claims.find((c) => c.order === 3)?.verdict).toBe("UNTESTABLE");
  });

  test("the limit follows claim order even when the moderator lists them out of order", async () => {
    const claims = [testableClaim(6), testableClaim(1), testableClaim(2), testableClaim(3), testableClaim(4), testableClaim(5)];
    const log = makeCallLog();

    const result = await runPipeline("text", {
      runAgentFn: makeRunAgentFn({ claims: claims }, { verdicts: [] }),
      searchWebFn: makeSearchFn([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]),
      onAiCall: log.onAiCall,
    });

    expect(result.claims.find((c) => c.order === 6)?.reasoning).toBe("Not checked: a review checks at most 5 claims.");
    const searchCalls = log.calls.filter((call) => call.step === "SEARCH");
    expect(searchCalls).toHaveLength(5);
  });

  test("exactly 5 testable claims are all searched", async () => {
    const claims = [testableClaim(1), testableClaim(2), testableClaim(3), testableClaim(4), testableClaim(5)];
    let searches = 0;
    const search: SearchWebFn = async () => {
      searches++;
      return found([{ url: "https://site.com/a", title: "site.com", publishedAt: null }]);
    };

    const result = await runPipeline("text", {
      runAgentFn: makeRunAgentFn({ claims: claims }, { verdicts: [] }),
      searchWebFn: search,
    });

    expect(searches).toBe(5);
    for (const claim of result.claims) {
      expect(claim.reasoning).not.toBe("Not checked: a review checks at most 5 claims.");
    }
  });
});

// settings for calling runAttempts directly
function attemptContext(calls: AiCallRecord[], overrides: Partial<AttemptContext> = {}): AttemptContext {
  return {
    claimOrder: null,
    model: "test-model",
    retryDelayMs: 0,
    timeoutMs: 1000,
    onAiCall: async (record) => {
      calls.push(record);
    },
    ...overrides,
  };
}

describe("runAttempts", () => {
  test("an attempt that takes too long is failed as an ERROR with no tokens", async () => {
    const calls: AiCallRecord[] = [];
    const neverAnswers = () => new Promise<AgentReply>(() => {});

    await expect(
      runAttempts("MODERATOR", 3, neverAnswers, attemptContext(calls, { timeoutMs: 20 }))
    ).rejects.toThrow("timed out");

    // a timeout isn't a temporary gemini error, so it's not retried
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe("ERROR");
    expect(calls[0]?.usage).toBeNull();
    expect(calls[0]?.error).toContain("timed out");
    expect(calls[0]?.durationMs).toBeGreaterThanOrEqual(15);
  });

  test("waits the retry delay, then twice that, between agent attempts", async () => {
    const calls: AiCallRecord[] = [];
    const alwaysBusy = async (): Promise<AgentReply> => {
      throw new Error("503 high demand");
    };

    const started = Date.now();
    await expect(
      runAttempts("MODERATOR", 3, alwaysBusy, attemptContext(calls, { retryDelayMs: 20 }))
    ).rejects.toThrow("503 high demand");
    const elapsed = Date.now() - started;

    expect(calls).toHaveLength(3);
    // 20ms before attempt 2, 40ms before attempt 3
    expect(elapsed).toBeGreaterThanOrEqual(55);
  });

  test("keeps the claim order and model on every reported attempt", async () => {
    const calls: AiCallRecord[] = [];
    const works = async (): Promise<SearchReply> => found([]);

    await runAttempts("SEARCH", 2, works, attemptContext(calls, { claimOrder: 4, model: "m1" }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.claimOrder).toBe(4);
    expect(calls[0]?.model).toBe("m1");
    expect(calls[0]?.step).toBe("SEARCH");
  });

  test("starts no attempt at all when the review has already ended", async () => {
    const calls: AiCallRecord[] = [];
    let attempts = 0;
    const works = async (): Promise<AgentReply> => {
      attempts++;
      return reply({ ok: true });
    };

    await expect(
      runAttempts("MODERATOR", 3, works, attemptContext(calls, { shouldStop: () => true }))
    ).rejects.toBeInstanceOf(ReviewStoppedError);

    expect(attempts).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test("reports the attempt that was running when the review ended, but starts no retry", async () => {
    const calls: AiCallRecord[] = [];
    let ended = false;
    const busyUntilTheReviewEnds = async (): Promise<AgentReply> => {
      // the review times out while this attempt is still waiting on gemini
      ended = true;
      throw new Error("Gemini error 503: high demand");
    };

    await expect(
      runAttempts("MODERATOR", 3, busyUntilTheReviewEnds, attemptContext(calls, { shouldStop: () => ended }))
    ).rejects.toBeInstanceOf(ReviewStoppedError);

    // the running attempt is still counted, the 503 would normally have been retried
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe("ERROR");
  });

  test("works with no onAiCall at all", async () => {
    const works = async (): Promise<AgentReply> => reply({ ok: true });

    const result = await runAttempts("MODERATOR", 3, works, attemptContext([], { onAiCall: undefined }));

    expect(result.text).toBe('{"ok":true}');
  });
});

// a fake adk run: yields the given events one by one
async function* eventsOf(events: Event[]): AsyncGenerator<Event> {
  for (const event of events) {
    yield event;
  }
}

describe("readAgentEvents", () => {
  test("takes the usage of the last event that has one, never a sum", async () => {
    const events = [
      createEvent({ partial: true, usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } }),
      createEvent({
        content: { role: "model", parts: [{ text: '{"claims":[]}' }] },
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 8 },
      }),
    ];

    const result = await readAgentEvents(eventsOf(events));

    expect(result.text).toBe('{"claims":[]}');
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30, thinkingTokens: 8 });
  });

  test("keeps an earlier usage when the final event has none", async () => {
    const events = [
      createEvent({ partial: true, usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10 } }),
      createEvent({ content: { role: "model", parts: [{ text: "done" }] } }),
    ];

    const result = await readAgentEvents(eventsOf(events));

    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 10, thinkingTokens: 0 });
  });

  test("usage is null when no event carries any", async () => {
    const events = [createEvent({ content: { role: "model", parts: [{ text: "done" }] } })];

    const result = await readAgentEvents(eventsOf(events));

    expect(result.usage).toBeNull();
  });

  test("throws gemini's error when an event carries one", async () => {
    const events = [createEvent({ errorCode: "503", errorMessage: "The model is overloaded" })];

    await expect(readAgentEvents(eventsOf(events))).rejects.toThrow("Gemini error 503: The model is overloaded");
  });

  test("throws when the run ends without a final answer", async () => {
    await expect(readAgentEvents(eventsOf([]))).rejects.toThrow("without a final response");
  });

  test("reads the run to the end after the answer, so ADK can close its tracing spans", async () => {
    let runFinished = false;
    async function* run(): AsyncGenerator<Event> {
      yield createEvent({ content: { role: "model", parts: [{ text: "first answer" }] } });
      yield createEvent({ content: { role: "model", parts: [{ text: "later text" }] } });
      // ADK ends its spans here, after the last event
      runFinished = true;
    }

    const result = await readAgentEvents(run());

    expect(runFinished).toBe(true);
    expect(result.text).toBe("first answer");
  });
});
