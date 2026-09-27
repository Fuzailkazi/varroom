import { GoogleGenAI } from "@google/genai";
import { DEFAULT_GEMINI_MODEL } from "./types.ts";

export type WebSource = {
  url: string;
  title: string;
  publishedAt: Date | null;
};

// Calls Gemini with Google Search grounding and returns the web sources
// that Gemini cited. publishedAt is always null — the grounding API does not
// return publication dates.
export async function searchWeb(query: string): Promise<WebSource[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
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

  return sources;
}
