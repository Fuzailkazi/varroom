import { maybeSetOtelProviders } from "@google/adk";
import type { OTelHooks } from "@google/adk";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// Optional export of ADK's traces to Langfuse, a hosted UI for looking at
// agent runs. ADK already records OpenTelemetry spans (one per agent run and
// one per model call). Here we build the exporter that sends them.
//
// It is off unless both Langfuse keys are set, so tests and a fresh .env
// export nothing. It can never fail a review: spans are sent in the
// background, in batches, and a failed send is dropped quietly.
//
// Only ADK's spans are sent. Once a tracer provider exists, other libraries
// that speak OpenTelemetry (better auth, for sign in and session lookups)
// record spans too, and those don't belong in Langfuse.

// the tracer name ADK records its spans under
export const ADK_TRACER_NAME = "gcp.vertex.agent";

export const DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com";

// Langfuse's OpenTelemetry endpoint for traces
export const LANGFUSE_TRACES_PATH = "/api/public/otel/v1/traces";

// the span attribute Langfuse reads to group traces into one session
export const LANGFUSE_SESSION_ATTRIBUTE = "langfuse.session.id";

// the env vars this file reads. process.env fits this type
export type TracingEnv = Record<string, string | undefined>;

// where to send spans and which headers to send with them
export type LangfuseExportConfig = {
  tracesEndpoint: string;
  headers: Record<string, string>;
};

// the ADK function that registers the span processors. tests pass a fake
export type SetProvidersFn = (hooks: OTelHooks[]) => void;

// one span processor, the type ADK expects inside its hooks
export type SpanProcessor = NonNullable<OTelHooks["spanProcessors"]>[number];
type WritableSpan = Parameters<SpanProcessor["onStart"]>[0];
type FinishedSpan = Parameters<SpanProcessor["onEnd"]>[0];

// the processor that sends spans to Langfuse, kept so the cli can flush it
// before it exits. null while tracing is off
let exportProcessor: SpanProcessor | null = null;

// reads an env var, treating blank as unset
function readSetting(env: TracingEnv, name: string): string | null {
  const value = env[name];
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed;
}

// Builds the export settings from the env. Returns null when either key is
// missing, which means tracing stays off. Throws when LANGFUSE_HOST is not a
// url, because otherwise OpenTelemetry would quietly send to localhost.
export function langfuseExportConfig(env: TracingEnv): LangfuseExportConfig | null {
  const publicKey = readSetting(env, "LANGFUSE_PUBLIC_KEY");
  const secretKey = readSetting(env, "LANGFUSE_SECRET_KEY");
  if (publicKey === null || secretKey === null) {
    return null;
  }

  // "https://cloud.langfuse.com/" and "https://cloud.langfuse.com" mean the same host
  let host = readSetting(env, "LANGFUSE_HOST") ?? DEFAULT_LANGFUSE_HOST;
  while (host.endsWith("/")) {
    host = host.slice(0, -1);
  }
  if (!URL.canParse(host)) {
    throw new Error(`LANGFUSE_HOST must be a url like ${DEFAULT_LANGFUSE_HOST}, got "${host}".`);
  }

  // basic auth: the two keys joined by a colon, in base64
  const credentials = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");

  return {
    tracesEndpoint: host + LANGFUSE_TRACES_PATH,
    headers: {
      Authorization: `Basic ${credentials}`,
      // without it Langfuse can show new spans up to 10 minutes late
      "x-langfuse-ingestion-version": "4",
    },
  };
}

// Wraps a processor so it only sees ADK's spans. Every other finished span
// (better auth's, for example) is dropped here and never exported.
export function onlyAdkSpans(next: SpanProcessor): SpanProcessor {
  return {
    onStart(span, parentContext) {
      next.onStart(span, parentContext);
    },
    onEnd(span: FinishedSpan) {
      if (span.instrumentationScope.name === ADK_TRACER_NAME) {
        next.onEnd(span);
      }
    },
    forceFlush() {
      return next.forceFlush();
    },
    shutdown() {
      return next.shutdown();
    },
  };
}

// Sends any spans still waiting in the batch. The cli calls it before it
// exits, because the batch goes out every few seconds and a finished process
// would drop it. Gives up after timeoutMs so a slow Langfuse can't hang the
// cli, and never throws. Does nothing while tracing is off.
export async function flushTracing(timeoutMs: number = 5000, processor: SpanProcessor | null = exportProcessor): Promise<void> {
  if (processor === null) {
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });

  try {
    await Promise.race([processor.forceFlush(), giveUp]);
  } catch (err) {
    console.error("tracing: could not send the last traces:", err);
  } finally {
    clearTimeout(timer);
  }
}

// the session id ADK wrote on a span, if any. agent spans carry it as
// gen_ai.conversation.id, model call spans as gcp.vertex.agent.session_id
function adkSessionId(span: WritableSpan): string | null {
  const fromAgent = span.attributes["gen_ai.conversation.id"];
  if (typeof fromAgent === "string") {
    return fromAgent;
  }
  const fromModelCall = span.attributes["gcp.vertex.agent.session_id"];
  if (typeof fromModelCall === "string") {
    return fromModelCall;
  }
  return null;
}

// Copies ADK's session id (the review id) onto the attribute Langfuse groups
// sessions by. It runs just before a span ends, when ADK has set its
// attributes. ADK's outer "invocation" span has no session id of its own,
// but it ends after its children, so we remember the id per trace and tag
// it too. A span processor runs inside ADK's own code, so it must never
// throw: an error here would fail the review.
export function reviewSessionTagger(): SpanProcessor {
  // trace id -> review id, for the spans of a run that are still open
  const sessionByTrace = new Map<string, string>();

  return {
    onStart() {},
    onEnding(span) {
      try {
        const traceId = span.spanContext().traceId;

        // 1. which review is this span from? its own attribute first, then its trace
        let sessionId = adkSessionId(span);
        if (sessionId !== null) {
          sessionByTrace.set(traceId, sessionId);
        } else {
          sessionId = sessionByTrace.get(traceId) ?? null;
        }

        // 2. tag it
        if (sessionId !== null) {
          span.setAttribute(LANGFUSE_SESSION_ATTRIBUTE, sessionId);
        }

        // 3. the outer span (it has no parent) ends last, so the run is over
        if (span.parentSpanContext === undefined) {
          sessionByTrace.delete(traceId);
        }
      } catch (err) {
        console.error("tracing: could not tag a span with its review id:", err);
      }
    },
    onEnd() {},
    forceFlush() {
      return Promise.resolve();
    },
    shutdown() {
      return Promise.resolve();
    },
  };
}

// Turns on the Langfuse export when both keys are set. Call it once, when the
// process starts. Returns true when the export is on, false when it stays off.
// It never throws: tracing is optional, so a bad setting only logs a line.
export function setupTracing(env: TracingEnv = process.env, setProviders: SetProvidersFn = maybeSetOtelProviders): boolean {
  try {
    const config = langfuseExportConfig(env);
    if (config === null) {
      return false;
    }

    // 1. our own exporter, sending in the background in batches, behind the
    // ADK only filter. we don't set the OTEL_EXPORTER_OTLP_* env vars, so ADK
    // adds no exporter of its own that would send every span unfiltered
    const exporter = new OTLPTraceExporter({ url: config.tracesEndpoint, headers: config.headers });
    const processor = onlyAdkSpans(new BatchSpanProcessor(exporter));

    // 2. register the providers. the tagger runs first, so every span the
    // filter passes on is already tagged with its review id
    setProviders([{ spanProcessors: [reviewSessionTagger(), processor] }]);
    exportProcessor = processor;

    console.log(`tracing: sending ADK traces to ${config.tracesEndpoint}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`tracing: staying off, ${message}`);
    return false;
  }
}
