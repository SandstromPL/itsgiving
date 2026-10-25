import { z } from "zod";
import { COOLDOWN_MS, Cooldowns, DailyBudget, createProviders, llmConfigFromEnv, mockProvider, type LlmMode } from "./config";
import { toJsonSchema } from "./schema";
import {
  LlmError,
  type Effort,
  type LlmCall,
  type LlmErrorKind,
  type LlmProvider,
  type LlmProviderKind,
  type Reasoning,
  type SkipReason,
} from "./types";

export interface LlmDeps {
  mode: LlmMode;
  /** Real providers in fallback order; the mock is always tried last. */
  providers: LlmProvider[];
  budget: DailyBudget;
  /** Longest a single call may take; the deadline can make it shorter. */
  timeoutMs: number;
  cooldowns: Cooldowns;
}

export interface GenerateJsonOptions<T> {
  /** Short name for logs, the JSON Schema title and the UI timeline, e.g. "plan". */
  name: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Deterministic output the labelled mock returns. Must satisfy `schema`. */
  mock: () => T;
  effort?: Effort;
  /** DeepSeek's thinking depth for this step; unset leaves thinking off. */
  reasoning?: Reasoning;
  maxOutputTokens?: number;
  /** Fixes harmless shape slips in the parsed reply before validation, so they don't cost a repair call. */
  normalize?: (value: unknown) => unknown;
  signal?: AbortSignal;
  /** Epoch ms by which a result is needed; real providers are skipped once too little time is left. */
  deadline?: number;
  /** Shortest call worth starting before the deadline (a write needs longer than a plan). */
  minCallMs?: number;
  /** Longest a single call of this step may take; defaults to deps.timeoutMs. */
  timeoutMs?: number;
}

export type AttemptOutcome = "ok" | "repaired" | "invalid" | "error" | "skipped";

export interface LlmAttempt {
  provider: LlmProviderKind;
  model: string;
  outcome: AttemptOutcome;
  kind?: LlmErrorKind | SkipReason;
  message?: string;
  ms: number;
}

export interface ProducedBy {
  provider: LlmProviderKind;
  model: string;
  mock: boolean;
  /** How deeply the model thought, when it honours the request (DeepSeek). */
  reasoning?: Reasoning;
}

export interface LlmResult<T> {
  data: T;
  producedBy: ProducedBy;
  attempts: LlmAttempt[];
  /** Real LLM calls this result spent, repairs included. */
  calls: number;
  /** True when live mode had to settle for the mock. */
  degraded: boolean;
}

/** Below this, starting a real call is pointless: it can't finish in time. */
export const MIN_CALL_MS = 3_000;

let shared: LlmDeps | undefined;

/** Process-wide providers, daily budget and cooldowns, built from the environment once. */
export function getLlm(): LlmDeps {
  if (!shared) {
    const config = llmConfigFromEnv();
    shared = {
      mode: config.mode,
      providers: createProviders(config),
      budget: new DailyBudget(config.dailyCap),
      timeoutMs: config.timeoutMs,
      cooldowns: new Cooldowns(),
    };
  }
  return shared;
}

/** Pull the JSON object out of a reply that may be wrapped in a code fence or prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("No JSON object in the reply.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

type Checked<T> = { ok: true; data: T } | { ok: false; problem: string };

function check<T>(schema: z.ZodType<T>, text: string, normalize?: (value: unknown) => unknown): Checked<T> {
  let value: unknown;
  try {
    value = extractJson(text);
  } catch (err) {
    return { ok: false, problem: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parsed = schema.safeParse(normalize ? normalize(value) : value);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, problem: z.prettifyError(parsed.error) };
}

function repairPrompt(prompt: string, reply: string, problem: string): string {
  return (
    `${prompt}\n\nYOUR PREVIOUS REPLY WAS REJECTED\n` +
    `Reply:\n${reply.slice(0, 3000)}\n` +
    `Problems:\n${problem.slice(0, 1200)}\n` +
    "Send the whole JSON object again, fixed. Use only the refs and values the schema allows."
  );
}

function abortError(provider: LlmProvider): LlmError {
  return new LlmError({ kind: "aborted", message: "Request aborted.", provider: provider.kind, model: provider.model });
}

/**
 * Ask for JSON matching `schema`: try each provider in order, give each one
 * repair retry when its output fails validation, and fall through on 429, 5xx,
 * timeouts and invalid output. Providers that just failed rest for a while,
 * and no call outlives the deadline. The labelled mock is always the last resort.
 */
export async function generateJson<T>(options: GenerateJsonOptions<T>, deps: LlmDeps = getLlm()): Promise<LlmResult<T>> {
  const signal = options.signal ?? new AbortController().signal;
  const deadline = options.deadline ?? Number.POSITIVE_INFINITY;
  const schema = toJsonSchema(options.schema);
  const attempts: LlmAttempt[] = [];
  let calls = 0;
  const chain = deps.mode === "live" ? [...deps.providers, mockProvider] : [mockProvider];

  for (const provider of chain) {
    const isMock = provider.kind === "mock";
    const started = Date.now();
    const record = (outcome: AttemptOutcome, extra: Partial<LlmAttempt> = {}) =>
      attempts.push({ provider: provider.kind, model: provider.model, outcome, ms: Date.now() - started, ...extra });

    /** The time this call may take, or why it shouldn't start (cooldown, too little time, daily cap). */
    let clamped = false;
    const callTimeout = options.timeoutMs ?? deps.timeoutMs;
    const admit = (): { ok: true; budgetMs: number } | { ok: false; kind: SkipReason; message: string } => {
      if (isMock) return { ok: true, budgetMs: callTimeout };
      if (deps.cooldowns.active(provider)) return { ok: false, kind: "cooldown", message: "Failed recently; resting." };
      const left = deadline - Date.now();
      if (left < (options.minCallMs ?? MIN_CALL_MS)) {
        return { ok: false, kind: "deadline", message: `Only ${Math.max(left, 0)} ms left for this step.` };
      }
      if (!deps.budget.take()) return { ok: false, kind: "daily_cap", message: "Daily LLM call cap reached." };
      calls += 1;
      // A call cut short by the run's deadline isn't the provider's fault; remember that for the cooldown below.
      clamped = left < callTimeout;
      return { ok: true, budgetMs: Math.min(callTimeout, left) };
    };

    const run = async (prompt: string, timeoutMs: number): Promise<string> => {
      if (signal.aborted) throw abortError(provider);
      const timeout = AbortSignal.timeout(timeoutMs);
      const call: LlmCall = {
        system: options.system,
        prompt,
        schema,
        schemaName: options.name,
        maxOutputTokens: options.maxOutputTokens ?? 4096,
        effort: options.effort ?? "low",
        reasoning: options.reasoning,
        signal: AbortSignal.any([signal, timeout]),
        mock: options.mock,
      };
      try {
        return (await provider.complete(call)).text;
      } catch (err) {
        if (signal.aborted) throw abortError(provider);
        if (err instanceof LlmError) throw err;
        const timedOut = timeout.aborted || (err instanceof Error && err.name === "TimeoutError");
        throw new LlmError({
          kind: timedOut ? "timeout" : "network",
          message: `${provider.kind} ${provider.model}: ${timedOut ? `no reply within ${timeoutMs} ms` : err instanceof Error ? err.message : String(err)}`,
          provider: provider.kind,
          model: provider.model,
        });
      }
    };

    try {
      const firstTurn = admit();
      if (!firstTurn.ok) {
        record("skipped", { kind: firstTurn.kind, message: firstTurn.message });
        continue;
      }
      const first = await run(options.prompt, firstTurn.budgetMs);
      const firstCheck = check(options.schema, first, options.normalize);
      if (firstCheck.ok) {
        record("ok");
        return finish(firstCheck.data, provider);
      }
      if (isMock) throw new Error(`Mock output for "${options.name}" does not match its schema: ${firstCheck.problem}`);

      const repairTurn = admit();
      if (!repairTurn.ok) {
        // Keep the validation failure on record even though there's no turn left to repair it.
        record("invalid", { kind: "invalid_output", message: `${firstCheck.problem.slice(0, 240)} (no repair: ${repairTurn.message})` });
        continue;
      }
      const second = await run(repairPrompt(options.prompt, first, firstCheck.problem), repairTurn.budgetMs);
      const secondCheck = check(options.schema, second, options.normalize);
      if (secondCheck.ok) {
        // Keep what the first reply got wrong: it shows which provider needs prompt help.
        record("repaired", { message: `First reply: ${firstCheck.problem.slice(0, 240)}` });
        return finish(secondCheck.data, provider);
      }
      // Keep both problems: whether the repair got closer or went wrong elsewhere is the first thing to check.
      record("invalid", {
        kind: "invalid_output",
        message: `First reply: ${firstCheck.problem.slice(0, 200)} Repair: ${secondCheck.problem.slice(0, 200)}`,
      });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      if (err.kind === "aborted") throw err;
      const outOfTime = err.kind === "timeout" && clamped;
      const rest = outOfTime ? undefined : COOLDOWN_MS[err.kind];
      if (rest !== undefined) deps.cooldowns.trip(provider, Math.max(rest, err.retryAfterMs ?? 0));
      record("error", { kind: outOfTime ? "deadline" : err.kind, message: err.message.slice(0, 300) });
    }
  }
  // Unreachable: the mock either returns or throws a programming error.
  throw new Error(`generateJson("${options.name}") exhausted every provider.`);

  function finish(data: T, provider: LlmProvider): LlmResult<T> {
    const mock = provider.kind === "mock";
    return {
      data,
      producedBy: {
        provider: provider.kind,
        model: provider.model,
        mock,
        ...(provider.thinks && options.reasoning ? { reasoning: options.reasoning } : {}),
      },
      attempts,
      calls,
      degraded: mock && deps.mode === "live",
    };
  }
}
