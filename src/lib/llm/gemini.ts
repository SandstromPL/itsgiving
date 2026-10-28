import type { FetchLike } from "../qloo";
import { failFor, postJson } from "./post";
import { GEMINI_KEYWORDS, sanitizeSchema } from "./schema";
import { retryAfterHeader, type LlmCall, type LlmCompletion, type LlmProvider } from "./types";

// Gemini through Google AI Studio, REST generateContent. Shapes checked against
// https://ai.google.dev/api/generate-content (GenerationConfig, ThinkingConfig)
// and the generate-content thinking guide on 2026-10-24:
//   POST /v1beta/models/{model}:generateContent with header x-goog-api-key,
//   generationConfig.responseMimeType + responseJsonSchema (JSON Schema subset),
//   generationConfig.thinkingConfig.thinkingLevel ("minimal" errors on 3.8 Flash),
//   thought parts carry `thought: true` and are skipped when reading the answer.

export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const BLOCKING_FINISH = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string; status?: string; details?: { "@type"?: string; retryDelay?: string }[] };
}

/** Gemini puts the wait in error.details[].retryDelay ("33s") rather than a header. */
function retryDelayMs(json: GeminiResponse, header: string | null): number | undefined {
  const delay = json.error?.details?.find((d) => d["@type"]?.endsWith("RetryInfo"))?.retryDelay;
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : retryAfterHeader(header);
}

export function geminiProvider(options: {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Overrides the per-step effort, e.g. "high" to give the model more thinking time. */
  thinkingLevel?: "low" | "medium" | "high";
}): LlmProvider {
  const { apiKey, model } = options;
  const fail = failFor("Gemini", "gemini", model);

  return {
    kind: "gemini",
    model,
    async complete(call: LlmCall): Promise<LlmCompletion> {
      const json = await postJson<GeminiResponse>({
        url: `${options.baseUrl ?? GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
        headers: { "x-goog-api-key": apiKey },
        body: {
          systemInstruction: { parts: [{ text: call.system }] },
          contents: [{ role: "user", parts: [{ text: call.prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: sanitizeSchema(call.schema, GEMINI_KEYWORDS),
            maxOutputTokens: call.maxOutputTokens,
            thinkingConfig: { thinkingLevel: options.thinkingLevel ?? call.effort },
          },
        },
        signal: call.signal,
        fetch: options.fetch,
        fail,
        retryAfterMs: (reply, headers) => retryDelayMs(reply, headers.get("retry-after")),
      });

      if (json.promptFeedback?.blockReason) throw fail("blocked", `prompt blocked (${json.promptFeedback.blockReason})`);
      const candidate = json.candidates?.[0];
      if (!candidate) throw fail("empty", "returned no candidates");
      const finish = candidate.finishReason ?? "";
      if (BLOCKING_FINISH.has(finish)) throw fail("blocked", `output blocked (${finish})`);
      if (finish === "MAX_TOKENS") throw fail("truncated", "hit maxOutputTokens before finishing the JSON");
      const text = (candidate.content?.parts ?? [])
        .filter((part) => !part.thought && typeof part.text === "string")
        .map((part) => part.text)
        .join("");
      if (!text.trim()) throw fail("empty", `returned no text (finishReason ${finish || "unknown"})`);

      const usage = json.usageMetadata;
      return {
        text,
        usage: usage
          ? { inputTokens: usage.promptTokenCount, outputTokens: usage.candidatesTokenCount, thinkingTokens: usage.thoughtsTokenCount }
          : undefined,
      };
    },
  };
}
