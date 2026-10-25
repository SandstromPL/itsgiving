export type LlmProviderKind = "gemini" | "groq" | "deepseek" | "mock";

/** Maps to Gemini's thinkingLevel. Groq always reasons at low effort to fit its 8K tokens/min free tier. */
export type Effort = "low" | "medium";

/**
 * How deeply DeepSeek thinks before answering. The free fallbacks ignore it: more thinking made them
 * slower without making them better (benchmark, 2026-10-25).
 */
export type Reasoning = "low" | "high";

/** One request to one model, already provider-neutral. */
export interface LlmCall {
  system: string;
  prompt: string;
  /** JSON Schema of the expected output; each provider trims it to the keywords it supports. */
  schema: Record<string, unknown>;
  schemaName: string;
  /** Tokens for the answer itself; a provider that counts thinking against its limit adds room for it. */
  maxOutputTokens: number;
  effort: Effort;
  /** Unset means no thinking. */
  reasoning?: Reasoning;
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
  /** Honours LlmCall.reasoning, so a result can say how deeply it was thought through. */
  thinks?: boolean;
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
  /** How long the provider asked us to wait (Retry-After header or Gemini RetryInfo). */
  readonly retryAfterMs?: number;

  constructor(init: {
    kind: LlmErrorKind;
    message: string;
    provider: LlmProviderKind;
    model: string;
    status?: number;
    retryAfterMs?: number;
  }) {
    super(init.message);
    this.name = "LlmError";
    this.kind = init.kind;
    this.provider = init.provider;
    this.model = init.model;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** Why an attempt was skipped without calling the model. */
export type SkipReason = "daily_cap" | "cooldown" | "deadline";

const KIND_TEXT: Record<LlmErrorKind | SkipReason, string> = {
  config: "not configured",
  auth: "key rejected",
  rate_limit: "rate limited",
  upstream: "overloaded",
  timeout: "too slow",
  network: "unreachable",
  bad_request: "rejected the request",
  blocked: "blocked the output",
  truncated: "ran out of tokens",
  empty: "returned nothing",
  invalid_output: "invalid output",
  aborted: "cancelled",
  daily_cap: "daily cap reached",
  cooldown: "resting after recent failures",
  deadline: "out of time",
};

/** Plain words for an attempt's failure kind, for the UI and the treatment's notes. */
export function describeKind(kind: LlmErrorKind | SkipReason): string {
  return KIND_TEXT[kind] ?? kind;
}

/** Parse a Retry-After header (seconds or HTTP date). */
export function retryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(seconds, 0) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(date - Date.now(), 0);
}

export function classifyHttpStatus(status: number): LlmErrorKind {
  if (status === 401 || status === 403) return "auth";
  // Groq answers 413 when a request would blow the tokens-per-minute budget.
  if (status === 429 || status === 413) return "rate_limit";
  if (status >= 500) return "upstream";
  return "bad_request";
}
