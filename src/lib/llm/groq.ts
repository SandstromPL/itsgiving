import type { FetchLike } from "../qloo";
import { failFor, postJson } from "./post";
import { BASE_KEYWORDS, sanitizeSchema } from "./schema";
import { classifyHttpStatus, type LlmCall, type LlmCompletion, type LlmProvider } from "./types";

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

export function groqProvider(options: {
  apiKey: string;
  model: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Defaults to "low": reasoning tokens count against the free tier's 8K tokens per minute. */
  reasoningEffort?: "low" | "medium" | "high";
}): LlmProvider {
  const { apiKey, model } = options;
  const fail = failFor("Groq", "groq", model);

  return {
    kind: "groq",
    model,
    async complete(call: LlmCall): Promise<LlmCompletion> {
      const json = await postJson<GroqResponse>({
        url: `${options.baseUrl ?? GROQ_BASE_URL}/chat/completions`,
        headers: { authorization: `Bearer ${apiKey}` },
        body: {
          model,
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: call.prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: call.schemaName, strict: true, schema: sanitizeSchema(call.schema, BASE_KEYWORDS) },
          },
          reasoning_effort: options.reasoningEffort ?? "low",
          include_reasoning: false,
          max_completion_tokens: call.maxOutputTokens,
        },
        signal: call.signal,
        fetch: options.fetch,
        fail,
        kind: (status, reply, reason) => {
          const kind = classifyHttpStatus(status);
          // A best-effort schema miss also comes back as 400; treat it as bad output, not a bad request.
          const schemaMiss = kind === "bad_request" && /schema|json_validate/i.test(`${reason} ${reply.error?.code ?? ""}`);
          return schemaMiss ? "invalid_output" : kind;
        },
      });

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
