import type { FetchLike } from "../qloo";
import { deepseekProvider } from "./deepseek";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { LlmError, type LlmProvider } from "./types";

export type LlmMode = "live" | "mock";

// Chain order: Gemini primary -> Groq -> DeepSeek -> Gemini fallback. Measured
// live (2026-10-24/25): 3.5 Flash-Lite answered plan/write in 5-7 s and Groq
// gpt-oss-120b in 1-3 s (both free). DeepSeek Flash is paid, so it only runs
// when both free tiers fail; it writes the richest treatments but takes 15-20 s
// to write. 3.8 Flash returned 503s or took 100+ s, so it goes last.
export const DEFAULT_MODELS = {
  gemini: "gemini-3.5-flash-lite",
  groq: "openai/gpt-oss-120b",
  deepseek: "deepseek-flash",
  geminiFallback: "gemini-3.8-flash",
} as const;

export interface LlmConfig {
  mode: LlmMode;
  geminiApiKey?: string;
  groqApiKey?: string;
  deepseekApiKey?: string;
  /** First in the chain; "none" drops it. */
  geminiModel?: string;
  groqModel: string;
  deepseekModel: string;
  /** Last real model in the chain, after Groq and DeepSeek; "none" drops it. */
  geminiFallbackModel?: string;
  /** Real LLM calls allowed per UTC day across the process; the mock never counts. */
  dailyCap: number;
  timeoutMs: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * LLM_MODE wins when set; otherwise run live when any provider key is present
 * and fall back to the labelled mock so the app works with no keys at all.
 */
export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig {
  const geminiApiKey = env.GEMINI_API_KEY?.trim() || undefined;
  const groqApiKey = env.GROQ_API_KEY?.trim() || undefined;
  const deepseekApiKey = env.DEEPSEEK_API_KEY?.trim() || undefined;
  const requested = env.LLM_MODE?.trim().toLowerCase();
  const mode: LlmMode =
    requested === "mock" || requested === "live" ? requested : geminiApiKey || groqApiKey || deepseekApiKey ? "live" : "mock";
  const model = (value: string | undefined, fallback: string) => {
    const chosen = value?.trim() || fallback;
    return chosen === "none" ? undefined : chosen;
  };
  const geminiModel = model(env.GEMINI_MODEL, DEFAULT_MODELS.gemini);
  const geminiFallbackModel = model(env.GEMINI_FALLBACK_MODEL, DEFAULT_MODELS.geminiFallback);
  return {
    mode,
    geminiApiKey,
    groqApiKey,
    deepseekApiKey,
    geminiModel,
    groqModel: env.GROQ_MODEL?.trim() || DEFAULT_MODELS.groq,
    deepseekModel: env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODELS.deepseek,
    geminiFallbackModel: geminiFallbackModel === geminiModel ? undefined : geminiFallbackModel,
    dailyCap: positiveInt(env.LLM_DAILY_CAP, 300),
    // A healthy free-tier call takes under 10 s; waiting longer only burns the run budget.
    timeoutMs: positiveInt(env.LLM_TIMEOUT_MS, 20_000),
  };
}

/** The real providers in fallback order; the mock is appended by generateJson. */
export function createProviders(config: LlmConfig, fetchImpl?: FetchLike): LlmProvider[] {
  if (config.mode === "mock") return [];
  const providers: LlmProvider[] = [];
  const gemini = (model: string | undefined) => {
    if (config.geminiApiKey && model) providers.push(geminiProvider({ apiKey: config.geminiApiKey, model, fetch: fetchImpl }));
  };
  gemini(config.geminiModel);
  if (config.groqApiKey) providers.push(groqProvider({ apiKey: config.groqApiKey, model: config.groqModel, fetch: fetchImpl }));
  if (config.deepseekApiKey) {
    providers.push(deepseekProvider({ apiKey: config.deepseekApiKey, model: config.deepseekModel, fetch: fetchImpl }));
  }
  gemini(config.geminiFallbackModel);
  return providers;
}

/**
 * Deterministic stand-in used when no keys are set, LLM_MODE=mock, or every
 * real provider failed. Its output is always labelled "Mock LLM".
 */
export const mockProvider: LlmProvider = {
  kind: "mock",
  model: "mise-template",
  async complete(call) {
    if (call.signal.aborted) {
      throw new LlmError({ kind: "aborted", message: "Request aborted.", provider: "mock", model: "mise-template" });
    }
    return { text: JSON.stringify(call.mock()) };
  },
};

/** Counts real LLM calls per UTC day so free-tier quota survives a burst of demo traffic. */
export class DailyBudget {
  private day = "";
  private used = 0;

  constructor(
    readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private roll() {
    const today = this.now().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
  }

  take(): boolean {
    this.roll();
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }

  remaining(): number {
    this.roll();
    return Math.max(this.limit - this.used, 0);
  }
}

/**
 * Circuit breaker: a provider that just timed out, was overloaded or rate
 * limited is skipped for a while, so the next step (and the next treatment)
 * goes straight to one that works instead of waiting out the same timeout.
 */
export class Cooldowns {
  private readonly until = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  static key(provider: LlmProvider): string {
    return `${provider.kind}:${provider.model}`;
  }

  active(provider: LlmProvider): boolean {
    const until = this.until.get(Cooldowns.key(provider));
    return until !== undefined && until > this.now();
  }

  /** Rest a provider for `ms`, never shortening a longer rest already in place (e.g. a long Retry-After). */
  trip(provider: LlmProvider, ms: number): void {
    const key = Cooldowns.key(provider);
    this.until.set(key, Math.max(this.until.get(key) ?? 0, this.now() + ms));
  }
}

/** How long to rest a provider after each kind of failure; others (bad output, auth) don't trip it. */
export const COOLDOWN_MS: Partial<Record<LlmError["kind"], number>> = {
  rate_limit: 60_000,
  upstream: 120_000,
  timeout: 120_000,
  network: 30_000,
};
