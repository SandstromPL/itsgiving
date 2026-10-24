import { z } from "zod";
import { DailyBudget, createProviders, llmConfigFromEnv, mockProvider, type LlmMode } from "./config";
import { toJsonSchema } from "./schema";
import { LlmError, type Effort, type LlmCall, type LlmErrorKind, type LlmProvider, type LlmProviderKind } from "./types";

export interface LlmDeps {
  mode: LlmMode;
  /** Real providers in fallback order; the mock is always tried last. */
  providers: LlmProvider[];
  budget: DailyBudget;
  timeoutMs: number;
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
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export type AttemptOutcome = "ok" | "repaired" | "invalid" | "error" | "skipped";

export interface LlmAttempt {
  provider: LlmProviderKind;
  model: string;
  outcome: AttemptOutcome;
  kind?: LlmErrorKind | "daily_cap";
  message?: string;
  ms: number;
}

export interface ProducedBy {
  provider: LlmProviderKind;
  model: string;
  mock: boolean;
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

let shared: LlmDeps | undefined;

/** Process-wide providers and daily budget, built from the environment once. */
export function getLlm(): LlmDeps {
  if (!shared) {
    const config = llmConfigFromEnv();
    shared = {
      mode: config.mode,
      providers: createProviders(config),
      budget: new DailyBudget(config.dailyCap),
      timeoutMs: config.timeoutMs,
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

function check<T>(schema: z.ZodType<T>, text: string): Checked<T> {
  let value: unknown;
  try {
    value = extractJson(text);
  } catch (err) {
    return { ok: false, problem: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parsed = schema.safeParse(value);
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
 * timeouts and invalid output. The labelled mock is always the last resort.
 */
export async function generateJson<T>(options: GenerateJsonOptions<T>, deps: LlmDeps = getLlm()): Promise<LlmResult<T>> {
  const signal = options.signal ?? new AbortController().signal;
  const schema = toJsonSchema(options.schema);
  const attempts: LlmAttempt[] = [];
  let calls = 0;
  const chain = deps.mode === "live" ? [...deps.providers, mockProvider] : [mockProvider];

  for (const provider of chain) {
    const isMock = provider.kind === "mock";

    const run = async (prompt: string): Promise<string> => {
      if (signal.aborted) throw abortError(provider);
      const timeout = AbortSignal.timeout(deps.timeoutMs);
      const call: LlmCall = {
        system: options.system,
        prompt,
        schema,
        schemaName: options.name,
        maxOutputTokens: options.maxOutputTokens ?? 4096,
        effort: options.effort ?? "low",
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
          message: `${provider.kind} ${provider.model}: ${timedOut ? `no reply within ${deps.timeoutMs} ms` : err instanceof Error ? err.message : String(err)}`,
          provider: provider.kind,
          model: provider.model,
        });
      }
    };

    const spend = (): boolean => {
      if (isMock) return true;
      if (!deps.budget.take()) {
        attempts.push({ provider: provider.kind, model: provider.model, outcome: "skipped", kind: "daily_cap", message: "Daily LLM call cap reached.", ms: 0 });
        return false;
      }
      calls += 1;
      return true;
    };

    const started = Date.now();
    const record = (outcome: AttemptOutcome, extra: Partial<LlmAttempt> = {}) =>
      attempts.push({ provider: provider.kind, model: provider.model, outcome, ms: Date.now() - started, ...extra });

    try {
      if (!spend()) continue;
      const first = await run(options.prompt);
      const firstCheck = check(options.schema, first);
      if (firstCheck.ok) {
        record("ok");
        return finish(firstCheck.data, provider);
      }
      if (isMock) throw new Error(`Mock output for "${options.name}" does not match its schema: ${firstCheck.problem}`);

      if (!spend()) continue;
      const second = await run(repairPrompt(options.prompt, first, firstCheck.problem));
      const secondCheck = check(options.schema, second);
      if (secondCheck.ok) {
        record("repaired");
        return finish(secondCheck.data, provider);
      }
      record("invalid", { kind: "invalid_output", message: secondCheck.problem.slice(0, 300) });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      if (err.kind === "aborted") throw err;
      record("error", { kind: err.kind, message: err.message.slice(0, 300) });
    }
  }
  // Unreachable: the mock either returns or throws a programming error.
  throw new Error(`generateJson("${options.name}") exhausted every provider.`);

  function finish(data: T, provider: LlmProvider): LlmResult<T> {
    const mock = provider.kind === "mock";
    return {
      data,
      producedBy: { provider: provider.kind, model: provider.model, mock },
      attempts,
      calls,
      degraded: mock && deps.mode === "live",
    };
  }
}
