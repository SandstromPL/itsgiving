import { describe, expect, it } from "vitest";
import { Cooldowns, DailyBudget, LlmError, strictModeViolations, toJsonSchema, type LlmDeps, type LlmProvider } from "../llm";
import { createQlooClient } from "../qloo";
import { briefKey, briefSchema, normalizeBrief, pickKey, priceLevelMax, type BriefInput } from "./brief";
import { RateLimiter, TtlCache } from "./guards";
import { runPipeline, type PipelineOutcome } from "./pipeline";
import { planSchema } from "./plan";
import { streamTreatment, type TreatmentService } from "./service";
import type { AgentEvent, StepEvent } from "./types";
import { writeSchema, type WriteContext } from "./write";

const qloo = () => createQlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid" });
const mockLlm = (): LlmDeps => ({ mode: "mock", providers: [], budget: new DailyBudget(100), timeoutMs: 1000, cooldowns: new Cooldowns() });

const brief = (input: BriefInput) => normalizeBrief(briefSchema.parse(input));

async function run(input: BriefInput, llm: LlmDeps = mockLlm()) {
  const events: AgentEvent[] = [];
  const outcome = await runPipeline(brief(input), { qloo: qloo(), llm }, (e) => events.push(e), {
    id: "test",
    signal: new AbortController().signal,
  });
  return { outcome, events, steps: events.filter((e): e is StepEvent => e.type === "step") };
}

function treatmentOf(outcome: PipelineOutcome) {
  if (outcome.kind !== "treatment") throw new Error(`expected a treatment, got ${outcome.kind}: ${JSON.stringify(outcome)}`);
  return outcome.treatment;
}

/** A "live" provider that answers through the mock but can be scripted per step. */
function scriptedProvider(script: Partial<Record<string, (mock: Record<string, unknown>) => unknown>>) {
  const seen: string[] = [];
  const provider: LlmProvider = {
    kind: "gemini",
    model: "fake-flash",
    async complete(call) {
      seen.push(call.schemaName);
      const mock = call.mock() as Record<string, unknown>;
      const answer = script[call.schemaName]?.(mock) ?? mock;
      return { text: typeof answer === "string" ? answer : JSON.stringify(answer) };
    },
  };
  return { provider, seen };
}

const liveWith = (...providers: LlmProvider[]): LlmDeps => ({
  mode: "live",
  providers,
  budget: new DailyBudget(100),
  timeoutMs: 1000,
  cooldowns: new Cooldowns(),
});

describe("runPipeline (mock Qloo, mock LLM)", () => {
  it("builds a labelled treatment end to end with at most three LLM calls", async () => {
    const { outcome, steps } = await run({
      artist: "Prateek Kuhad",
      city: "Mumbai",
      director_films: ["In the Mood for Love", "Donnie Darko"],
    });
    const t = treatmentOf(outcome);
    expect(t.mock).toEqual({ qloo: true, llm: true });
    expect(t.writtenBy).toEqual({ provider: "mock", model: "mise-template", mock: true });
    expect(t.llm.length).toBeLessThanOrEqual(3);
    expect(t.references.length).toBeGreaterThan(0);
    expect(t.wardrobe.length).toBeGreaterThan(0);
    expect(t.locations.length).toBeGreaterThan(0);
    expect(t.locations.every((l) => l.entity.place?.city === "Mumbai")).toBe(true);
    expect(t.audience.overlap.length).toBeGreaterThan(0);
    expect(t.qloo.calls).toBeGreaterThan(5);
    expect(t.qloo.steps.references?.every((p) => p.mode === "mock")).toBe(true);
    // Qloo evidence travels with each pick, separate from the LLM's notes.
    expect(t.references[0].qloo).toMatchObject({ tool: "reference_films", rank: expect.any(Number) });
    expect(t.references[0].qloo.because[0]?.name).toBe("Prateek Kuhad");
    expect(t.references[0].notes.why).toBeTruthy();

    const finished = new Map(steps.filter((s) => s.status !== "running").map((s) => [s.id, s.status]));
    expect([...finished.keys()]).toEqual(
      expect.arrayContaining(["resolve", "audience", "overlap", "plan", "tags", "references", "wardrobe", "locations", "replan", "write"]),
    );
    expect(finished.get("replan")).toBe("skipped");
  });

  it("asks which title is meant, then continues once the user picks one of Qloo's candidates", async () => {
    const first = await run({ touchstones: ["Forgotten"], city: "New York" });
    expect(first.outcome.kind).toBe("needs_input");
    if (first.outcome.kind !== "needs_input") return;
    const [item] = first.outcome.items;
    expect(item).toMatchObject({ key: pickKey("movie", "Forgotten"), role: "touchstone", status: "ambiguous" });
    expect(item.candidates.length).toBe(2);

    const invented = await run({ touchstones: ["Forgotten"], city: "New York", picks: { [item.key]: "made-up-id" } });
    expect(invented.outcome.kind).toBe("needs_input");

    const picked = await run({ touchstones: ["Forgotten"], city: "New York", picks: { [item.key]: item.candidates[0].id } });
    expect(treatmentOf(picked.outcome).subjects[0].id).toBe(item.candidates[0].id);
  });

  it("fails clearly when nothing in the brief is in Qloo, and skips unknown taste films", async () => {
    const missing = await run({ artist: "Nobody Anyone Knows", city: "Mumbai" });
    expect(missing.outcome).toMatchObject({ kind: "failed", message: expect.stringContaining("Nobody Anyone Knows") });

    const partial = await run({ artist: "Frank Ocean", city: "New York", director_films: ["Not A Real Film Title"] });
    expect(treatmentOf(partial.outcome).notes.join(" ")).toContain("Not A Real Film Title");
  });

  it("relaxes empty location searches deterministically and says so", async () => {
    const { outcome } = await run({ artist: "The Weeknd", city: "Mumbai", budget: "shoestring", nudges: ["cheaper_locations"] });
    const t = treatmentOf(outcome);
    expect(t.priceLevelMax).toBe(1);
    expect(t.locations.length).toBeGreaterThan(0);
    expect(t.notes.join(" ")).toMatch(/Locations: nothing matched at first/);
  });

  it("applies nudges the code can guarantee", async () => {
    const { outcome } = await run({ artist: "Frank Ocean", city: "New York", nudges: ["more_90s"] });
    const t = treatmentOf(outcome);
    const query = t.qloo.steps.references?.[0]?.query ?? {};
    expect(query["filter.release_year.min"]).toBe("1990");
    expect(query["filter.release_year.max"]).toBe("1999");
  });

  it("reports a city Qloo cannot place as a location error without failing the treatment", async () => {
    const { outcome, steps } = await run({ artist: "Frank Ocean", city: "Atlantis" });
    const t = treatmentOf(outcome);
    expect(t.locations).toEqual([]);
    expect(steps.find((s) => s.id === "locations" && s.status === "error")).toBeTruthy();
  });
});

describe("runPipeline with a live provider", () => {
  it("re-plans once when the plan's style words find no Qloo tags (3 LLM calls total)", async () => {
    const nonsense = (mock: Record<string, unknown>) => ({ ...mock, wardrobe_words: ["qwxzv"], ambience_words: ["zzvqx"] });
    const { provider, seen } = scriptedProvider({ plan: nonsense });
    const { outcome, steps } = await run({ artist: "Frank Ocean", city: "New York" }, liveWith(provider));
    const t = treatmentOf(outcome);
    expect(seen).toEqual(["plan", "replan", "treatment"]);
    expect(t.llm.map((l) => l.step)).toEqual(["plan", "replan", "write"]);
    expect(t.writtenBy).toEqual({ provider: "gemini", model: "fake-flash", mock: false });
    expect(t.mock.llm).toBe(false);
    expect(steps.filter((s) => s.id === "tags" && s.status !== "running")).toHaveLength(2);
  });

  it("only lets the writer cite refs the tools returned (repairs an invented ref)", async () => {
    let tries = 0;
    const { provider } = scriptedProvider({
      treatment: (mock) => {
        tries += 1;
        if (tries > 1) return mock;
        const refs = mock.references as { ref: string }[];
        return { ...mock, references: [{ ...refs[0], ref: "R99" }, ...refs.slice(1)] };
      },
    });
    const { outcome } = await run({ artist: "Charli xcx", city: "New York" }, liveWith(provider));
    const t = treatmentOf(outcome);
    expect(tries).toBe(2);
    expect(t.llm.find((l) => l.step === "write")?.attempts[0].outcome).toBe("repaired");
    expect(t.references.length).toBeGreaterThan(0);
  });

  it("stops waiting on an overloaded primary for the write step once the plan step tripped it", async () => {
    let primaryCalls = 0;
    const flaky: LlmProvider = {
      kind: "gemini",
      model: "busy-flash",
      complete: async () => {
        primaryCalls += 1;
        throw new LlmError({ kind: "upstream", message: "503 high demand", provider: "gemini", model: "busy-flash", status: 503 });
      },
    };
    const { provider: backup } = scriptedProvider({});
    const { outcome } = await run({ artist: "Frank Ocean", city: "New York" }, liveWith(flaky, backup));
    const t = treatmentOf(outcome);
    expect(primaryCalls).toBe(1);
    expect(t.llm.find((l) => l.step === "write")?.attempts[0]).toMatchObject({ model: "busy-flash", outcome: "skipped", kind: "cooldown" });
    expect(t.writtenBy).toEqual({ provider: "gemini", model: "fake-flash", mock: false });
  });

  it("falls back to the labelled template when every model fails, and notes it", async () => {
    const down: LlmProvider = {
      kind: "groq",
      model: "down",
      complete: async () => {
        throw new LlmError({ kind: "rate_limit", message: "429", provider: "groq", model: "down", status: 429 });
      },
    };
    const { outcome } = await run({ artist: "Lana Del Rey", city: "New York" }, liveWith(down));
    const t = treatmentOf(outcome);
    expect(t.mock.llm).toBe(true);
    expect(t.llm.every((l) => l.degraded)).toBe(true);
    expect(t.notes.join(" ")).toContain("Live models were unavailable");
  });
});

describe("streamTreatment", () => {
  const service = (llm: LlmDeps = mockLlm()): TreatmentService => ({
    qloo: qloo(),
    llm,
    cache: new TtlCache(10, 60_000),
    limiter: new RateLimiter(5, 60_000),
    runTimeoutMs: 10_000,
  });

  it("replays a cached treatment without re-running the pipeline", async () => {
    const svc = service();
    const b = brief({ artist: "Bon Iver", city: "New York" });
    const first: AgentEvent[] = [];
    await streamTreatment(b, svc, (e) => first.push(e), new AbortController().signal);
    expect(first.at(-1)).toEqual({ type: "done" });
    expect(first.find((e) => e.type === "treatment")).toMatchObject({ cached: false });

    const second: AgentEvent[] = [];
    await streamTreatment(b, svc, (e) => second.push(e), new AbortController().signal);
    expect(second.map((e) => e.type)).toEqual(["start", "treatment", "done"]);
    expect(second[1]).toMatchObject({ cached: true });
  });

  it("does not cache a degraded live treatment", async () => {
    const down: LlmProvider = {
      kind: "gemini",
      model: "down",
      complete: async () => {
        throw new LlmError({ kind: "upstream", message: "503", provider: "gemini", model: "down", status: 503 });
      },
    };
    const svc = service(liveWith(down));
    const b = brief({ artist: "Bon Iver", city: "New York" });
    await streamTreatment(b, svc, () => {}, new AbortController().signal);
    const again: AgentEvent[] = [];
    await streamTreatment(b, svc, (e) => again.push(e), new AbortController().signal);
    expect(again.find((e) => e.type === "start")).toMatchObject({ cached: false });
  });

  it("turns a needs-input outcome into an event", async () => {
    const events: AgentEvent[] = [];
    await streamTreatment(brief({ touchstones: ["Forgotten"], city: "Mumbai" }), service(), (e) => events.push(e), new AbortController().signal);
    expect(events.map((e) => e.type)).toContain("needs_input");
    expect(events.at(-1)).toEqual({ type: "done" });
  });
});

describe("brief", () => {
  it("needs an artist or a touchstone", () => {
    expect(briefSchema.safeParse({ city: "Mumbai" }).success).toBe(false);
    expect(briefSchema.safeParse({ city: "Mumbai", artist: "  " }).success).toBe(false);
    expect(briefSchema.safeParse({ city: "Mumbai", touchstones: ["Drive"] }).success).toBe(true);
  });

  it("keys equivalent briefs the same and nudged briefs differently", () => {
    const modes = { qloo: "mock", llm: "mock" };
    const a = brief({ artist: "Frank Ocean", city: "New York", director_films: ["Her", "Drive"] });
    const b = brief({ artist: " frank ocean ", city: "new york", director_films: ["Drive", "Her", "drive"] });
    const c = brief({ artist: "Frank Ocean", city: "New York", director_films: ["Her", "Drive"], nudges: ["darker"] });
    expect(briefKey(a, modes)).toBe(briefKey(b, modes));
    expect(briefKey(a, modes)).not.toBe(briefKey(c, modes));
    expect(briefKey(a, modes)).not.toBe(briefKey(a, { qloo: "live", llm: "mock" }));
  });

  it("lowers the price ceiling one notch for cheaper locations", () => {
    expect(priceLevelMax(brief({ artist: "x", city: "y", budget: "premium" }))).toBeUndefined();
    expect(priceLevelMax(brief({ artist: "x", city: "y", budget: "premium", nudges: ["cheaper_locations"] }))).toBe(3);
    expect(priceLevelMax(brief({ artist: "x", city: "y", budget: "shoestring", nudges: ["cheaper_locations"] }))).toBe(1);
  });
});

describe("LLM schemas", () => {
  it("are Groq strict-mode compatible (every property required, no extra properties)", () => {
    const entity = { id: "e", name: "n", tags: [] };
    const ctx = {
      tone: [{ ref: "T1", tag: { id: "urn:tag:x", name: "x" }, source: "audience" }],
      references: [{ ref: "R1", item: entity }],
      brands: [{ ref: "B1", item: entity }],
      places: [{ ref: "L1", item: entity }],
    } as unknown as WriteContext;
    expect(strictModeViolations(toJsonSchema(planSchema(["T1", "T2"])))).toEqual([]);
    expect(strictModeViolations(toJsonSchema(planSchema([])))).toEqual([]);
    expect(strictModeViolations(toJsonSchema(writeSchema(ctx)))).toEqual([]);
  });
});

describe("guards", () => {
  it("rate-limits per key within a sliding window", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("a")).toEqual({ ok: false, retryAfterMs: 1000 });
    expect(limiter.check("b").ok).toBe(true);
    now = 1001;
    expect(limiter.check("a").ok).toBe(true);
  });

  it("expires and evicts cache entries", () => {
    let now = 0;
    const cache = new TtlCache<number>(2, 100, () => now);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    now = 200;
    expect(cache.get("a")).toBeUndefined();
  });
});
