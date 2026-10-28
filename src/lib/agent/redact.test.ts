import { describe, expect, it } from "vitest";
import { Cooldowns, DailyBudget, LlmError, type LlmProvider } from "../llm";
import { createQlooClient } from "../qloo";
import { briefSchema, normalizeBrief } from "./brief";
import { RateLimiter, TtlCache } from "./guards";
import { forBrowser } from "./redact";
import { sealOf } from "./seal";
import { cacheKeyFor, sseFrame, streamTreatment, type TreatmentService } from "./service";
import type { AgentEvent, Treatment } from "./types";

// What a provider says when it fails can carry details of the account behind it (DeepSeek's 401 names the key's last
// characters). The server log keeps it; the browser, and every page saved or shared from what it was sent, must not.
const PROVIDER_TEXT = "Authentication Fails, Your api key: ****f00d is invalid";

/** A paid model that always refuses: the template then writes, and each step's trace keeps the refusal's text. */
const refusing: LlmProvider = {
  kind: "deepseek",
  model: "deepseek-flash",
  thinks: true,
  complete: async () => {
    throw new LlmError({
      kind: "auth",
      message: `DeepSeek deepseek-flash: HTTP 401: ${PROVIDER_TEXT}`,
      provider: "deepseek",
      model: "deepseek-flash",
      status: 401,
    });
  },
};

const SECRET = "test-secret";
const service = (): TreatmentService => ({
  qloo: createQlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid" }),
  llm: { mode: "live", providers: [refusing], budget: new DailyBudget(100), timeoutMs: 1000, cooldowns: new Cooldowns() },
  cache: new TtlCache(10, 60_000),
  limiter: new RateLimiter(5, 60_000),
  // Long enough for the plan and write steps to call the model at all: they won't start one with too little time left.
  runTimeoutMs: 60_000,
  seal: (treatment) => sealOf(treatment, SECRET),
});

const brief = normalizeBrief(briefSchema.parse({ artist: "Bon Iver", city: "New York" }));

async function stream(svc: TreatmentService): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await streamTreatment(brief, svc, (event) => events.push(event), new AbortController().signal);
  return events;
}

const treatmentEvent = (events: AgentEvent[]) => {
  const event = events.find((e): e is Extract<AgentEvent, { type: "treatment" }> => e.type === "treatment");
  if (!event) throw new Error(`no treatment among ${events.map((e) => e.type).join(", ")}`);
  return event;
};

/** A treatment as the server keeps it, every attempt with its provider's words. */
const withMessages = (t: Treatment): Treatment => ({
  ...t,
  llm: t.llm.map((trace) => ({ ...trace, attempts: trace.attempts.map((a) => ({ ...a, message: `${a.model}: ${PROVIDER_TEXT}` })) })),
});

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

describe("forBrowser", () => {
  it("drops every attempt's message, keeps everything else, and leaves the server's copy as it was", async () => {
    const raw = withMessages(treatmentEvent(await stream(service())).treatment);
    const before = JSON.stringify(raw);
    const browser = forBrowser(raw);

    expect(JSON.stringify(browser)).not.toContain(PROVIDER_TEXT);
    const unsaid = (attempt: object) => Object.fromEntries(Object.entries(attempt).filter(([key]) => key !== "message"));
    const withoutMessages = { ...raw, llm: raw.llm.map((t) => ({ ...t, attempts: t.attempts.map(unsaid) })) };
    expect(json(browser)).toEqual(json(withoutMessages));
    expect(JSON.stringify(raw)).toBe(before);
  });
});

describe("the treatment event", () => {
  it("never carries a model's error text when built fresh, and its seal is over exactly what was sent", async () => {
    const event = treatmentEvent(await stream(service()));
    expect(sseFrame(event)).not.toContain(PROVIDER_TEXT);
    expect(event.seal).toBe(sealOf(event.treatment, SECRET));
    // What failed is still there in plain words: which model, and why.
    expect(event.treatment.llm.flatMap((t) => t.attempts)).toContainEqual(
      expect.objectContaining({ provider: "deepseek", outcome: "error", kind: "auth" }),
    );
  });

  it("never carries it when replayed from the cache, where the server keeps the messages", async () => {
    const svc = service();
    const kept = withMessages(treatmentEvent(await stream(svc)).treatment);
    svc.cache.set(cacheKeyFor(brief, svc), kept);
    const event = treatmentEvent(await stream(svc));
    expect(event.cached).toBe(true);
    expect(sseFrame(event)).not.toContain(PROVIDER_TEXT);
    expect(event.seal).toBe(sealOf(event.treatment, SECRET));
  });
});

describe("the step events", () => {
  // Known leak, reported rather than fixed here: the plan, re-plan and write steps send their LLM trace
  // (StepEvent.llm, from runPipeline's llm()) as it is, messages included, and only the treatment event goes through
  // forBrowser. The studio never shows the messages, but they're in the stream. Make this an ordinary `it` once fixed.
  it("never carry a model's error text either", async () => {
    const steps = (await stream(service())).filter((e) => e.type === "step");
    for (const step of steps) expect(sseFrame(step)).not.toContain(PROVIDER_TEXT);
  });
});
