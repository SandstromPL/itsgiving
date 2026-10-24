export type LlmProviderKind = "gemini" | "groq" | "mock";

/** Maps to Gemini's thinkingLevel. Groq always reasons at low effort to fit its 8K tokens/min free tier. */
export type Effort = "low" | "medium";

/** One request to one model, already provider-neutral. */
export interface LlmCall {
  system: string;
  prompt: string;
  /** JSON Schema of the expected output; each provider trims it to the keywords it supports. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
  effort: Effort;
  signal: AbortSignal;
  /** Deterministic output for the mock provider. */
  mock: () => unknown;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
}

export interface LlmCompletion {
  text: string;
  usage?: LlmUsage;
}

export interface LlmProvider {
  kind: LlmProviderKind;
  model: string;
  /** Returns the raw text the model produced; throws LlmError on any failure. */
  complete(call: LlmCall): Promise<LlmCompletion>;
}

export type LlmErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "upstream"
  | "timeout"
  | "network"
  | "bad_request"
  | "blocked"
  | "truncated"
  | "empty"
  | "invalid_output"
  | "aborted";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly provider: LlmProviderKind;
  readonly model: string;
  readonly status?: number;

  constructor(init: { kind: LlmErrorKind; message: string; provider: LlmProviderKind; model: string; status?: number }) {
    super(init.message);
    this.name = "LlmError";
    this.kind = init.kind;
    this.provider = init.provider;
    this.model = init.model;
    this.status = init.status;
  }
}

export function classifyHttpStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return "auth";
  // Groq answers 413 when a request would blow the tokens-per-minute budget.
  if (status === 429 || status === 413) return "rate_limit";
  if (status >= 500) return "upstream";
  return "bad_request";
}
