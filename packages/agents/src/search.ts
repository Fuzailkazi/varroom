import { GoogleGenAI } from "@google/genai";
import { geminiModel } from "./types.ts";
import type { SearchReply, WebSource } from "./types.ts";
import { toTokenUsage } from "./usage.ts";

export type { WebSource } from "./types.ts";

// Calls Gemini once with Google Search grounding and returns the web sources
// that Gemini cited, plus the tokens the call used. publishedAt is always
// null — the grounding API does not return publication dates.
// Retries and the timeout live in the pipeline, not here.
export async function searchWeb(query: string): Promise<SearchReply> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: geminiModel(),
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const chunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

  const sources: WebSource[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const web = chunk.web;
    if (!web?.uri) continue;
    if (seen.has(web.uri)) continue;
    seen.add(web.uri);
    sources.push({
      url: web.uri,
      title: web.title ?? "",
      publishedAt: null,
    });
  }

  return { sources: sources, usage: toTokenUsage(response.usageMetadata) };
}
