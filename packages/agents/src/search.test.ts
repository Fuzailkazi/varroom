import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// searchWeb talks to Gemini, which is a network boundary, so the SDK is
// replaced with a fake that returns whatever grounding chunks a test sets.
let fakeChunks: unknown[] = [];
let lastRequest: { model?: string; config?: unknown } = {};

mock.module("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (request: { model: string; config: unknown }) => {
        lastRequest = request;
        return { candidates: [{ groundingMetadata: { groundingChunks: fakeChunks } }] };
      },
    };
  },
}));

// Imported after the mock so searchWeb picks up the fake SDK.
const { searchWeb } = await import("./search.ts");

const savedKey = process.env.GEMINI_API_KEY;
const savedModel = process.env.GEMINI_MODEL;

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_MODEL;
  fakeChunks = [];
});

afterEach(() => {
  process.env.GEMINI_API_KEY = savedKey;
  if (savedModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = savedModel;
});

describe("searchWeb", () => {
  test("returns one source per grounding chunk, with its url and title", async () => {
    fakeChunks = [
      { web: { uri: "https://a.com/1", title: "a.com" } },
      { web: { uri: "https://b.com/2", title: "b.com" } },
    ];

    const sources = await searchWeb("Bellingham false 9 vs 8 stats");

    expect(sources).toEqual([
      { url: "https://a.com/1", title: "a.com", publishedAt: null },
      { url: "https://b.com/2", title: "b.com", publishedAt: null },
    ]);
  });

  test("asks Gemini to ground the answer with Google Search", async () => {
    await searchWeb("query");

    expect(lastRequest.config).toEqual({ tools: [{ googleSearch: {} }] });
  });

  test("drops a repeated url so the same page is never counted twice", async () => {
    fakeChunks = [
      { web: { uri: "https://a.com/1", title: "a.com" } },
      { web: { uri: "https://a.com/1", title: "a.com" } },
    ];

    const sources = await searchWeb("query");

    expect(sources).toHaveLength(1);
  });

  test("skips chunks that have no web url", async () => {
    fakeChunks = [{ web: { title: "no url" } }, {}, { web: { uri: "https://a.com", title: "a.com" } }];

    const sources = await searchWeb("query");

    expect(sources.map((source) => source.url)).toEqual(["https://a.com"]);
  });

  test("uses an empty title when the chunk has none", async () => {
    fakeChunks = [{ web: { uri: "https://a.com" } }];

    const sources = await searchWeb("query");

    expect(sources.at(0)?.title).toBe("");
  });

  test("returns an empty list when the search found nothing", async () => {
    const sources = await searchWeb("query");

    expect(sources).toEqual([]);
  });

  test("uses GEMINI_MODEL when set, and gemini-2.5-flash when not", async () => {
    await searchWeb("query");
    expect(lastRequest.model).toBe("gemini-2.5-flash");

    process.env.GEMINI_MODEL = "some-other-model";
    await searchWeb("query");
    expect(lastRequest.model).toBe("some-other-model");
  });

  test("throws a clear error when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(searchWeb("query")).rejects.toThrow("GEMINI_API_KEY is not set");
  });
});
