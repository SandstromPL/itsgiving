import type { FetchLike } from "../qloo";
import { BASE_KEYWORDS, sanitizeSchema } from "./schema";
import { LlmError, classifyHttpStatus, retryAfterHeader, type LlmCall, type LlmCompletion, type LlmProvider } from "./types";

// Groq's OpenAI-compatible chat completions. Shapes checked against
// https://console.groq.com/docs/structured-outputs and /docs/reasoning on
// 2026-10-24: openai/gpt-oss-120b supports response_format json_schema with
// strict: true (every property required, additionalProperties false),
// reasoning_effort low|medium|high, and include_reasoning (reasoning_format is
// not supported for GPT-OSS). The free tier allows only 8K tokens per minute,
// so reasoning stays at low effort and is not sent back.

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

interface GroqResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: string };
}

export function groqProvider(options: { apiKey: string; model: string; fetch?: FetchLike; baseUrl?: string }): LlmProvider {
  const { apiKey, model } = options;
  const fail = (kind: LlmError["kind"], message: string, status?: number, retryAfterMs?: number) =>
    new LlmError({ kind, message: `Groq ${model}: ${message}`, provider: "groq", model, status, retryAfterMs });

  return {
    kind: "groq",
    model,
    async complete(call: LlmCall): Promise<LlmCompletion> {
      const body = {
        model,
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: call.prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: call.schemaName, strict: true, schema: sanitizeSchema(call.schema, BASE_KEYWORDS) },
        },
        reasoning_effort: "low",
        include_reasoning: false,
        max_completion_tokens: call.maxOutputTokens,
      };
      const response = await (options.fetch ?? fetch)(`${options.baseUrl ?? GROQ_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: call.signal,
      });
      const raw = await response.text();
      let json: GroqResponse = {};
      try {
        json = raw ? (JSON.parse(raw) as GroqResponse) : {};
      } catch {
        if (response.ok) throw fail("upstream", "returned invalid JSON", response.status);
      }
      if (!response.ok) {
        const reason = json.error?.message ?? raw.slice(0, 200);
        const kind = classifyHttpStatus(response.status);
        // A best-effort schema miss also comes back as 400; treat it as bad output, not a bad request.
        const schemaMiss = kind === "bad_request" && /schema|json_validate/i.test(`${reason} ${json.error?.code ?? ""}`);
        throw fail(
          schemaMiss ? "invalid_output" : kind,
          `HTTP ${response.status}${reason ? `: ${reason}` : ""}`,
          response.status,
          retryAfterHeader(response.headers.get("retry-after")),
        );
      }

      const choice = json.choices?.[0];
      if (choice?.finish_reason === "length") throw fail("truncated", "hit max_completion_tokens before finishing the JSON");
      const text = choice?.message?.content ?? "";
      if (!text.trim()) throw fail("empty", "returned no content");
      return {
        text,
        usage: json.usage ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens } : undefined,
      };
    },
  };
}
