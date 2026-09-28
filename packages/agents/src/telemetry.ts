import { maybeSetOtelProviders } from "@google/adk";
import type { OTelHooks } from "@google/adk";

// Optional export of ADK's traces to Langfuse, a hosted UI for looking at
// agent runs. ADK already records OpenTelemetry spans (one per agent run and
// one per model call). Here we only tell ADK where to send them.
//
// It is off unless both Langfuse keys are set, so tests and a fresh .env
// export nothing. It can never fail a review: spans are sent in the
// background, in batches, and a failed send is dropped quietly.

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
type SpanProcessor = NonNullable<OTelHooks["spanProcessors"]>[number];
type WritableSpan = Parameters<SpanProcessor["onStart"]>[0];

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

// ADK builds its exporter from the standard OpenTelemetry env vars, so this
// turns our settings into those. Headers are written as key=value pairs
// joined by commas, with each value url encoded (base64 can contain "=").
export function otelTraceEnvVars(config: LangfuseExportConfig): Record<string, string> {
  const pairs: string[] = [];
  for (const [name, value] of Object.entries(config.headers)) {
    pairs.push(`${name}=${encodeURIComponent(value)}`);
  }

  return {
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: config.tracesEndpoint,
    OTEL_EXPORTER_OTLP_TRACES_HEADERS: pairs.join(","),
  };
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

    // 1. tell ADK's bundled OTLP exporter where to send spans
    const otelVars = otelTraceEnvVars(config);
    for (const [name, value] of Object.entries(otelVars)) {
      process.env[name] = value;
    }

    // 2. register the providers. ADK adds its exporter (sending in the
    // background, in batches) because the endpoint above is now set.
    // Our tagger runs first, so every span it tags is sent tagged
    setProviders([{ spanProcessors: [reviewSessionTagger()] }]);

    console.log(`tracing: sending ADK traces to ${config.tracesEndpoint}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`tracing: staying off, ${message}`);
    return false;
  }
}
