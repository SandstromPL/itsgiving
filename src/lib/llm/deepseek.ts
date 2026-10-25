import type { FetchLike } from "../qloo";
import { BASE_KEYWORDS, sanitizeSchema } from "./schema";
import { LlmError, classifyHttpStatus, retryAfterHeader, type LlmCall, type LlmCompletion, type LlmProvider, type Reasoning } from "./types";

// DeepSeek's OpenAI-compatible chat completions (paid key). Shapes checked
// against https://api-docs.deepseek.com (models, JSON Output and Thinking
// Mode guides) on 2026-10-25: model "deepseek-flash" (DeepSeek-V4.1-Flash),
// response_format {type: "json_object"} only (no json_schema), and the prompt
// must say "json" and show the expected shape, so the JSON Schema goes into
// the prompt and zod still validates the reply. Thinking is on upstream by
// default; a step turns it on with a depth (reasoning_effort low or high) or
// leaves it off. JSON mode can occasionally return empty content, which falls
// through like any failure.

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

interface DeepSeekResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string };
}

/** The schema rides in the prompt because DeepSeek only enforces "some JSON object". */
export function schemaInPrompt(prompt: string, schema: Record<string, unknown>): string {
  return `${prompt}\n\nReply with one json object that validates against this JSON Schema:\n${JSON.stringify(sanitizeSchema(schema, BASE_KEYWORDS))}`;
}

/** Reasoning tokens count against max_tokens, so thinking gets this much room on top of the answer's budget. */
const REASONING_TOKENS: Record<Reasoning, number> = { low: 4_096, high: 8_192 };

export function deepseekProvider(options: { apiKey: string; model: string; fetch?: FetchLike; baseUrl?: string }): LlmProvider {
  const { apiKey, model } = options;
  const fail = (kind: LlmError["kind"], message: string, status?: number, retryAfterMs?: number) =>
    new LlmError({ kind, message: `DeepSeek ${model}: ${message}`, provider: "deepseek", model, status, retryAfterMs });

  return {
    kind: "deepseek",
    model,
    thinks: true,
    async complete(call: LlmCall): Promise<LlmCompletion> {
      const { reasoning } = call;
      const body = {
        model,
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: schemaInPrompt(call.prompt, call.schema) },
        ],
        response_format: { type: "json_object" },
        thinking: { type: reasoning ? "enabled" : "disabled" },
        ...(reasoning ? { reasoning_effort: reasoning } : {}),
        max_tokens: call.maxOutputTokens + (reasoning ? REASONING_TOKENS[reasoning] : 0),
      };
      const response = await (options.fetch ?? fetch)(`${options.baseUrl ?? DEEPSEEK_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: call.signal,
      });
      const raw = await response.text();
      let json: DeepSeekResponse = {};
      try {
        json = raw ? (JSON.parse(raw) as DeepSeekResponse) : {};
      } catch {
        if (response.ok) throw fail("upstream", "returned invalid JSON", response.status);
      }
      if (!response.ok) {
        const reason = json.error?.message ?? raw.slice(0, 200);
        // 402 is "Insufficient Balance": out of paid credit, so rest it like a rate limit rather than retrying.
        const kind = response.status === 402 ? "rate_limit" : classifyHttpStatus(response.status);
        throw fail(kind, `HTTP ${response.status}${reason ? `: ${reason}` : ""}`, response.status, retryAfterHeader(response.headers.get("retry-after")));
      }

      const choice = json.choices?.[0];
      if (choice?.finish_reason === "length") throw fail("truncated", "hit max_tokens before finishing the JSON");
      const text = choice?.message?.content ?? "";
      if (!text.trim()) throw fail("empty", "returned no content");
      return {
        text,
        usage: json.usage ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens } : undefined,
      };
    },
  };
}
