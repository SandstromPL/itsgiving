import type { FetchLike } from "../qloo";
import { GEMINI_KEYWORDS, sanitizeSchema } from "./schema";
import { LlmError, classifyHttpStatus, retryAfterHeader, type LlmCall, type LlmCompletion, type LlmProvider } from "./types";

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

export function geminiProvider(options: { apiKey: string; model: string; fetch?: FetchLike; baseUrl?: string }): LlmProvider {
  const { apiKey, model } = options;
  const fail = (kind: LlmError["kind"], message: string, status?: number, retryAfterMs?: number) =>
    new LlmError({ kind, message: `Gemini ${model}: ${message}`, provider: "gemini", model, status, retryAfterMs });

  return {
    kind: "gemini",
    model,
    async complete(call: LlmCall): Promise<LlmCompletion> {
      const body = {
        systemInstruction: { parts: [{ text: call.system }] },
        contents: [{ role: "user", parts: [{ text: call.prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: sanitizeSchema(call.schema, GEMINI_KEYWORDS),
          maxOutputTokens: call.maxOutputTokens,
          thinkingConfig: { thinkingLevel: call.effort },
        },
      };
      const url = `${options.baseUrl ?? GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
      const response = await (options.fetch ?? fetch)(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: call.signal,
      });
      const raw = await response.text();
      let json: GeminiResponse = {};
      try {
        json = raw ? (JSON.parse(raw) as GeminiResponse) : {};
      } catch {
        if (response.ok) throw fail("upstream", "returned invalid JSON", response.status);
      }
      if (!response.ok) {
        const reason = json.error?.message ?? raw.slice(0, 200);
        throw fail(
          classifyHttpStatus(response.status),
          `HTTP ${response.status}${reason ? `: ${reason}` : ""}`,
          response.status,
          retryDelayMs(json, response.headers.get("retry-after")),
        );
      }

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
