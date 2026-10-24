import type { FetchLike } from "../qloo";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
import { LlmError, type LlmProvider } from "./types";

export type LlmMode = "live" | "mock";

export const DEFAULT_MODELS = {
  gemini: "gemini-3.8-flash",
  geminiFallback: "gemini-3.5-flash-lite",
  groq: "openai/gpt-oss-120b",
} as const;

export interface LlmConfig {
  mode: LlmMode;
  geminiApiKey?: string;
  groqApiKey?: string;
  geminiModels: string[];
  groqModel: string;
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
  const requested = env.LLM_MODE?.trim().toLowerCase();
  const mode: LlmMode =
    requested === "mock" || requested === "live" ? requested : geminiApiKey || groqApiKey ? "live" : "mock";
  const geminiModels = [
    env.GEMINI_MODEL?.trim() || DEFAULT_MODELS.gemini,
    env.GEMINI_FALLBACK_MODEL?.trim() || DEFAULT_MODELS.geminiFallback,
  ];
  return {
    mode,
    geminiApiKey,
    groqApiKey,
    geminiModels: [...new Set(geminiModels.filter((m) => m !== "none"))],
    groqModel: env.GROQ_MODEL?.trim() || DEFAULT_MODELS.groq,
    dailyCap: positiveInt(env.LLM_DAILY_CAP, 300),
    timeoutMs: positiveInt(env.LLM_TIMEOUT_MS, 30_000),
  };
}

/** The real providers in fallback order; the mock is appended by generateJson. */
export function createProviders(config: LlmConfig, fetchImpl?: FetchLike): LlmProvider[] {
  if (config.mode === "mock") return [];
  const providers: LlmProvider[] = [];
  if (config.geminiApiKey) {
    for (const model of config.geminiModels) {
      providers.push(geminiProvider({ apiKey: config.geminiApiKey, model, fetch: fetchImpl }));
    }
  }
  if (config.groqApiKey) providers.push(groqProvider({ apiKey: config.groqApiKey, model: config.groqModel, fetch: fetchImpl }));
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
