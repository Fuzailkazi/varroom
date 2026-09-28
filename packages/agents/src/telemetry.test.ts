import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { BaseLlm, LLMRegistry } from "@google/adk";
import type { BaseLlmConnection, LlmRequest, LlmResponse, OTelHooks } from "@google/adk";
import {
  DEFAULT_LANGFUSE_HOST,
  LANGFUSE_SESSION_ATTRIBUTE,
  LANGFUSE_TRACES_PATH,
  langfuseExportConfig,
  otelTraceEnvVars,
  reviewSessionTagger,
  setupTracing,
} from "./telemetry.ts";
import { runPipeline } from "./pipeline.ts";
import type { SearchWebFn } from "./pipeline.ts";

const KEYS = { LANGFUSE_PUBLIC_KEY: "pk-lf-test", LANGFUSE_SECRET_KEY: "sk-lf-test" };

// what "Basic <base64 of pk:sk>" should be for the keys above
const EXPECTED_AUTHORIZATION = `Basic ${btoa("pk-lf-test:sk-lf-test")}`;

// the env vars setupTracing writes for ADK. every test puts them back
const OTEL_VARS = ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "OTEL_EXPORTER_OTLP_TRACES_HEADERS"];

function clearOtelVars() {
  for (const name of OTEL_VARS) {
    delete process.env[name];
  }
}

afterEach(() => {
  clearOtelVars();
});

// a fake of ADK's provider setup that only remembers what it was given
function makeFakeSetProviders() {
  const calls: OTelHooks[][] = [];
  const setProviders = (hooks: OTelHooks[]) => {
    calls.push(hooks);
  };
  return { calls, setProviders };
}

describe("langfuseExportConfig", () => {
  test("is null when either key is missing or blank", () => {
    expect(langfuseExportConfig({})).toBeNull();
    expect(langfuseExportConfig({ LANGFUSE_PUBLIC_KEY: "pk-lf-test" })).toBeNull();
    expect(langfuseExportConfig({ LANGFUSE_SECRET_KEY: "sk-lf-test" })).toBeNull();
    expect(langfuseExportConfig({ LANGFUSE_PUBLIC_KEY: "  ", LANGFUSE_SECRET_KEY: "sk-lf-test" })).toBeNull();
  });

  test("with both keys it points at Langfuse cloud with basic auth", () => {
    const config = langfuseExportConfig(KEYS);

    expect(config).not.toBeNull();
    expect(config?.tracesEndpoint).toBe("https://cloud.langfuse.com/api/public/otel/v1/traces");
    expect(config?.tracesEndpoint).toBe(DEFAULT_LANGFUSE_HOST + LANGFUSE_TRACES_PATH);
    expect(config?.headers.Authorization).toBe(EXPECTED_AUTHORIZATION);
  });

  test("the auth header decodes back to public:secret", () => {
    const config = langfuseExportConfig(KEYS);
    const encoded = config?.headers.Authorization?.replace("Basic ", "") ?? "";

    expect(atob(encoded)).toBe("pk-lf-test:sk-lf-test");
  });

  test("uses LANGFUSE_HOST, trimmed and without a trailing slash", () => {
    const config = langfuseExportConfig({ ...KEYS, LANGFUSE_HOST: " https://us.cloud.langfuse.com/ " });

    expect(config?.tracesEndpoint).toBe("https://us.cloud.langfuse.com/api/public/otel/v1/traces");
  });

  test("a blank LANGFUSE_HOST falls back to Langfuse cloud", () => {
    const config = langfuseExportConfig({ ...KEYS, LANGFUSE_HOST: "" });

    expect(config?.tracesEndpoint).toBe(DEFAULT_LANGFUSE_HOST + LANGFUSE_TRACES_PATH);
  });

  test("a LANGFUSE_HOST that is not a url throws a clear message", () => {
    expect(() => langfuseExportConfig({ ...KEYS, LANGFUSE_HOST: "cloud.langfuse.com" })).toThrow(
      'LANGFUSE_HOST must be a url like https://cloud.langfuse.com, got "cloud.langfuse.com".'
    );
  });
});

describe("otelTraceEnvVars", () => {
  test("writes the endpoint and the headers as url encoded key=value pairs", () => {
    const config = langfuseExportConfig(KEYS);
    if (config === null) throw new Error("expected a config");

    const vars = otelTraceEnvVars(config);

    expect(vars.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe(config.tracesEndpoint);
    const pairs = vars.OTEL_EXPORTER_OTLP_TRACES_HEADERS?.split(",") ?? [];
    expect(pairs).toEqual([
      `Authorization=${encodeURIComponent(EXPECTED_AUTHORIZATION)}`,
      "x-langfuse-ingestion-version=4",
    ]);
  });

  test("a base64 value with = signs survives the encoding", () => {
    // "a:b" is "YTpi", "ab:c" is "YWI6Yw==": the second one has padding
    const vars = otelTraceEnvVars({ tracesEndpoint: "https://x.test", headers: { Authorization: "Basic YWI6Yw==" } });

    expect(vars.OTEL_EXPORTER_OTLP_TRACES_HEADERS).toBe("Authorization=Basic%20YWI6Yw%3D%3D");
    const value = vars.OTEL_EXPORTER_OTLP_TRACES_HEADERS?.split("=").slice(1).join("=") ?? "";
    expect(decodeURIComponent(value)).toBe("Basic YWI6Yw==");
  });
});

describe("setupTracing", () => {
  test("without keys it returns false and registers nothing", () => {
    const fake = makeFakeSetProviders();

    expect(setupTracing({}, fake.setProviders)).toBe(false);
    expect(setupTracing({ LANGFUSE_PUBLIC_KEY: "pk-lf-test" }, fake.setProviders)).toBe(false);

    expect(fake.calls).toHaveLength(0);
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined();
  });

  test("with keys it points ADK's exporter at Langfuse and adds the review id tagger", () => {
    const fake = makeFakeSetProviders();

    expect(setupTracing(KEYS, fake.setProviders)).toBe(true);

    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe(DEFAULT_LANGFUSE_HOST + LANGFUSE_TRACES_PATH);
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS).toContain(
      `Authorization=${encodeURIComponent(EXPECTED_AUTHORIZATION)}`
    );
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.[0]?.spanProcessors).toHaveLength(1);
  });

  test("a bad LANGFUSE_HOST keeps tracing off without throwing", () => {
    const fake = makeFakeSetProviders();

    expect(setupTracing({ ...KEYS, LANGFUSE_HOST: "not a url" }, fake.setProviders)).toBe(false);

    expect(fake.calls).toHaveLength(0);
    expect(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBeUndefined();
  });

  test("if registering the providers throws, it returns false instead of throwing", () => {
    const broken = () => {
      throw new Error("provider already set");
    };

    expect(setupTracing(KEYS, broken)).toBe(false);
  });
});

// a stand in for the span ADK hands to a span processor. a span with no
// parent is the outer one of a run
function makeFakeSpan(traceId: string, hasParent: boolean, attributes: Record<string, unknown>) {
  const span = {
    attributes: { ...attributes },
    parentSpanContext: hasParent ? { traceId: traceId, spanId: "parent" } : undefined,
    spanContext() {
      return { traceId: traceId, spanId: "span" };
    },
    setAttribute(name: string, value: unknown) {
      span.attributes[name] = value;
      return span;
    },
  };
  return span;
}

type FakeSpan = ReturnType<typeof makeFakeSpan>;
type Tagger = ReturnType<typeof reviewSessionTagger>;
type TaggerSpan = Parameters<NonNullable<Tagger["onEnding"]>>[0];

// ends a fake span, just like ADK's provider would call the tagger
function endSpan(tagger: Tagger, span: FakeSpan) {
  tagger.onEnding?.(span as unknown as TaggerSpan);
}

describe("reviewSessionTagger", () => {
  test("copies the session id of an agent span onto the Langfuse session attribute", () => {
    const span = makeFakeSpan("trace-1", true, { "gen_ai.conversation.id": "review-1" });
    endSpan(reviewSessionTagger(), span);
    expect(span.attributes[LANGFUSE_SESSION_ATTRIBUTE]).toBe("review-1");
  });

  test("copies the session id of a model call span too", () => {
    const span = makeFakeSpan("trace-1", true, { "gcp.vertex.agent.session_id": "review-2" });
    endSpan(reviewSessionTagger(), span);
    expect(span.attributes[LANGFUSE_SESSION_ATTRIBUTE]).toBe("review-2");
  });

  test("tags the outer span of a run with the id its children carried", () => {
    const tagger = reviewSessionTagger();
    const child = makeFakeSpan("trace-1", true, { "gen_ai.conversation.id": "review-1" });
    const outer = makeFakeSpan("trace-1", false, {});

    endSpan(tagger, child);
    endSpan(tagger, outer);

    expect(outer.attributes[LANGFUSE_SESSION_ATTRIBUTE]).toBe("review-1");
  });

  test("forgets a run once its outer span ends, and never mixes two runs", () => {
    const tagger = reviewSessionTagger();
    endSpan(tagger, makeFakeSpan("trace-1", true, { "gen_ai.conversation.id": "review-1" }));
    endSpan(tagger, makeFakeSpan("trace-1", false, {}));

    // a later span of the same trace id and a span of another run get nothing
    const late = makeFakeSpan("trace-1", false, {});
    const otherRun = makeFakeSpan("trace-2", false, {});
    endSpan(tagger, late);
    endSpan(tagger, otherRun);

    expect(late.attributes[LANGFUSE_SESSION_ATTRIBUTE]).toBeUndefined();
    expect(otherRun.attributes[LANGFUSE_SESSION_ATTRIBUTE]).toBeUndefined();
  });

  test("leaves a span without a session id alone", () => {
    const span = makeFakeSpan("trace-1", true, { "gen_ai.operation.name": "invoke_agent" });
    endSpan(reviewSessionTagger(), span);
    expect(span.attributes[LANGFUSE_SESSION_ATTRIBUTE]).toBeUndefined();
  });

  test("never throws, even when the span refuses the attribute", () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const span = makeFakeSpan("trace-1", true, { "gen_ai.conversation.id": "review-3" });
    span.setAttribute = () => {
      throw new Error("span is read only");
    };

    try {
      expect(() => endSpan(reviewSessionTagger(), span)).not.toThrow();
      expect(logged).toHaveBeenCalledTimes(1);
    } finally {
      logged.mockRestore();
    }
  });
});

// ----- a real ADK run with tracing on, against a fake model and a fake Langfuse -----

const FAKE_MODEL = "fake-traced-gemini";
const REVIEW_ID = "7b0c6f4e-2a41-4d8e-9a55-0c1f0d7e9a11";

const MODERATOR_ANSWER = {
  claims: [
    {
      order: 1,
      claimText: "Saka is better on the right than on the left",
      type: "POSITIONAL_ROLE",
      entities: { player: "Saka", positionA: "right wing", positionB: "left wing" },
    },
  ],
};

const FACT_CHECKER_ANSWER = {
  verdicts: [{ claimOrder: 1, verdict: "VERIFIED", reasoning: "The source agrees.", citedLabels: ["E1"] }],
};

// true when the request is the fact checker's: the pipeline starts its input with "Claims:"
function isFactCheckerRequest(request: LlmRequest): boolean {
  for (const content of request.contents) {
    for (const part of content.parts ?? []) {
      if (part.text?.startsWith("Claims:")) {
        return true;
      }
    }
  }
  return false;
}

// A model ADK can run without calling Gemini: it answers with fixed JSON.
// Registering it lets a real LlmAgent use it when GEMINI_MODEL names it.
class FakeGemini extends BaseLlm {
  static override readonly supportedModels: Array<string | RegExp> = [FAKE_MODEL];

  async *generateContentAsync(request: LlmRequest): AsyncGenerator<LlmResponse, void> {
    let answer: object = MODERATOR_ANSWER;
    if (isFactCheckerRequest(request)) {
      answer = FACT_CHECKER_ANSWER;
    }
    yield {
      content: { role: "model", parts: [{ text: JSON.stringify(answer) }] },
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    };
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new Error("live mode is not used in tests");
  }
}

LLMRegistry.register(FakeGemini);

const fakeSearch: SearchWebFn = async () => {
  return {
    sources: [{ url: "https://example.com/saka", title: "example.com", publishedAt: null }],
    usage: null,
  };
};

type ReceivedExport = {
  path: string;
  authorization: string | null;
  body: unknown;
};

// A fake Langfuse that records every export and then answers 500,
// so every export ADK tries fails.
function startFailingCollector() {
  const received: ReceivedExport[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {
        body = null;
      }
      received.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        body: body,
      });
      return new Response("langfuse is down", { status: 500 });
    },
  });
  return { url: `http://localhost:${server.port}`, received, server };
}

type OtlpAttribute = { key: string; value: { stringValue?: string } };
type OtlpSpan = { name: string; attributes: OtlpAttribute[] };
type OtlpBody = { resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[] };

// every span in an OTLP json body, as its name plus a map of its string attributes
function spansIn(body: unknown): { name: string; attributes: Map<string, string> }[] {
  const spans: { name: string; attributes: Map<string, string> }[] = [];
  const otlp = body as OtlpBody;
  for (const resource of otlp.resourceSpans ?? []) {
    for (const scope of resource.scopeSpans ?? []) {
      for (const span of scope.spans ?? []) {
        const attributes = new Map<string, string>();
        for (const attribute of span.attributes ?? []) {
          if (attribute.value.stringValue !== undefined) {
            attributes.set(attribute.key, attribute.value.stringValue);
          }
        }
        spans.push({ name: span.name, attributes: attributes });
      }
    }
  }
  return spans;
}

async function waitUntil(check: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`gave up waiting after ${timeoutMs}ms`);
    }
    await Bun.sleep(100);
  }
}

// This registers a real global OpenTelemetry provider, which can't be undone
// in this process. Only this test runs real ADK agents, and every later export
// fails quietly, so the other test files are not affected.
describe("setupTracing with a real ADK run", () => {
  test(
    "a failing export neither fails nor slows the review, and the spans carry the review id",
    async () => {
      const collector = startFailingCollector();
      const savedModel = process.env.GEMINI_MODEL;
      process.env.GEMINI_MODEL = FAKE_MODEL;

      try {
        const on = setupTracing({ ...KEYS, LANGFUSE_HOST: collector.url });
        expect(on).toBe(true);

        // 1. the review runs to the end as if tracing were off
        const result = await runPipeline("Saka is better on the right than on the left", {
          searchWebFn: fakeSearch,
          reviewId: REVIEW_ID,
          retryDelayMs: 0,
        });
        expect(result.claims[0]?.verdict).toBe("VERIFIED");
        expect(result.score).not.toBeNull();

        // 2. spans leave in the background after the review, so it never waited on them
        expect(collector.received).toHaveLength(0);

        // 3. ADK's exporter sends its batch a few seconds later, to Langfuse's path with basic auth
        await waitUntil(() => collector.received.length > 0, 12_000);
        const sent = collector.received[0];
        expect(sent?.path).toBe(LANGFUSE_TRACES_PATH);
        expect(sent?.authorization).toBe(EXPECTED_AUTHORIZATION);

        // 4. both agent runs are there: the outer span, the agent span and its model call
        const spans = spansIn(sent?.body);
        const names = spans.map((span) => span.name).sort();
        expect(names).toEqual([
          "call_llm",
          "call_llm",
          "invocation",
          "invocation",
          "invoke_agent fact_checker",
          "invoke_agent moderator",
        ]);

        // 5. and every one of them carries the review id, so Langfuse groups them
        for (const span of spans) {
          expect(span.attributes.get(LANGFUSE_SESSION_ATTRIBUTE)).toBe(REVIEW_ID);
        }
      } finally {
        if (savedModel === undefined) delete process.env.GEMINI_MODEL;
        else process.env.GEMINI_MODEL = savedModel;
        collector.server.stop(true);
      }
    },
    20_000
  );
});
