import { describe, expect, it, vi } from "vitest";
import { Cooldowns, DailyBudget, LlmError, strictModeViolations, toJsonSchema, type LlmDeps, type LlmProvider } from "../llm";
import { QlooClient, createQlooClient, type FetchLike } from "../qloo";
import { MemoryCache } from "../qloo/cache";
import { createMockFetch } from "../qloo/mock/server";
import { briefKey, briefSchema, normalizeBrief, pickKey, priceLevelMax, type BriefInput } from "./brief";
import { RateLimiter, TtlCache } from "./guards";
import { clipSentences, closestTags, parseTitle, runPipeline, type PipelineOutcome } from "./pipeline";
import { planSchema } from "./plan";
import { cachedTreatment, streamTreatment, type TreatmentService } from "./service";
import type { AgentEvent, StepEvent } from "./types";
import { refScrubber, writeSchema, type WriteContext } from "./write";

const qloo = () => createQlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid" });
const mockLlm = (): LlmDeps => ({ mode: "mock", providers: [], budget: new DailyBudget(100), timeoutMs: 1000, cooldowns: new Cooldowns() });

const brief = (input: BriefInput) => normalizeBrief(briefSchema.parse(input));

/** The mock Qloo server, except requests matching `fails` get `failure` (a 503 unless given). */
function flakyQloo(fails: (url: string) => boolean, failure?: () => Promise<Response>) {
  const mock = createMockFetch();
  const fetchImpl: FetchLike = (url, init) =>
    fails(decodeURIComponent(url)) ? (failure ?? (async () => new Response("{}", { status: 503 })))() : mock(url, init);
  return new QlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid", fetch: fetchImpl, cache: new MemoryCache(), maxAttempts: 1 });
}

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
  /** schemaName:reasoning for every call, to check how hard each step was asked to think. */
  const depths: string[] = [];
  const provider: LlmProvider = {
    kind: "gemini",
    model: "fake-flash",
    async complete(call) {
      seen.push(call.schemaName);
      depths.push(`${call.schemaName}:${call.reasoning ?? "off"}`);
      const mock = call.mock() as Record<string, unknown>;
      const answer = script[call.schemaName]?.(mock) ?? mock;
      return { text: typeof answer === "string" ? answer : JSON.stringify(answer) };
    },
  };
  return { provider, seen, depths };
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
    expect(t.references[0].notes.why).toBeTruthy();
    // Films and places ask for explainability, so each pick names the input that drove it. Films use the
    // entity signal only: on the live host, tag signals made that query run up to a minute and end in a 504.
    expect(t.references[0].qloo.because[0]?.name).toBe("Prateek Kuhad");
    expect(t.locations[0].qloo.because[0]?.name).toBe("Prateek Kuhad");
    expect(t.qloo.steps.references?.[0].query).not.toHaveProperty("signal.interests.tags");
    expect(t.complete).toBe(true);

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

describe("runPipeline when Qloo or the models misbehave", () => {
  it("doesn't re-plan when the tag search failed rather than found nothing", async () => {
    const events: AgentEvent[] = [];
    const outcome = await runPipeline(
      brief({ artist: "Frank Ocean", city: "New York" }),
      { qloo: flakyQloo((url) => url.includes("/v2/tags")), llm: mockLlm() },
      (e) => events.push(e),
      { id: "t", signal: new AbortController().signal },
    );
    const t = treatmentOf(outcome);
    expect(t.llm.map((l) => l.step)).toEqual(["plan", "write"]);
    const replan = events.find((e): e is StepEvent => e.type === "step" && e.id === "replan");
    expect(replan?.summary).toMatch(/tag search failed/);
    expect(t.complete).toBe(false);
  });

  it("keeps the first plan when the re-plan can only come from the template", async () => {
    const nonsense = (mock: Record<string, unknown>) => ({ ...mock, wardrobe_words: ["qwxzv"], ambience_words: ["zzvqx"] });
    const { provider, seen } = scriptedProvider({ plan: nonsense, replan: () => "not json" });
    const { outcome } = await run({ artist: "Frank Ocean", city: "New York" }, liveWith(provider));
    const t = treatmentOf(outcome);
    expect(seen).toEqual(["plan", "replan", "replan", "treatment"]);
    expect(t.llm.find((l) => l.step === "replan")?.degraded).toBe(true);
    expect(t.notes.join(" ")).toContain("the first plan was kept");
    expect(t.writtenBy.mock).toBe(false);
  });

  it("resolves a title written with its year without asking", async () => {
    expect(parseTitle("Rockstar (2011)")).toEqual({ name: "Rockstar", year: 2011 });
    expect(parseTitle("Blade Runner 2049")).toEqual({ name: "Blade Runner 2049" });
    const { outcome } = await run({ touchstones: ["Forgotten (2017)"], city: "New York" });
    expect(treatmentOf(outcome).subjects[0]).toMatchObject({ name: "Forgotten", year: 2017 });
  });
});

describe("runPipeline with a live provider", () => {
  it("re-plans once when the plan's style words find no Qloo tags (3 LLM calls total)", async () => {
    const nonsense = (mock: Record<string, unknown>) => ({ ...mock, wardrobe_words: ["qwxzv"], ambience_words: ["zzvqx"] });
    const { provider, seen, depths } = scriptedProvider({ plan: nonsense });
    const { outcome, steps } = await run({ artist: "Frank Ocean", city: "New York" }, liveWith(provider));
    const t = treatmentOf(outcome);
    expect(seen).toEqual(["plan", "replan", "treatment"]);
    expect(depths).toEqual(["plan:high", "replan:low", "treatment:high"]);
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

  it("thinks deeply by default and briefly for a quick treatment", async () => {
    const deep = scriptedProvider({});
    await run({ artist: "Frank Ocean", city: "New York" }, liveWith(deep.provider));
    expect(deep.depths).toEqual(["plan:high", "treatment:high"]);
    const quick = scriptedProvider({});
    await run({ artist: "Frank Ocean", city: "New York", thinking: "quick" }, liveWith(quick.provider));
    expect(quick.depths).toEqual(["plan:low", "treatment:low"]);
  });

  it("flattens lighting notes sent as objects instead of spending a repair call", async () => {
    const { provider, seen } = scriptedProvider({
      treatment: (mock) => ({ ...mock, lighting: [{ setup: "One tungsten fresnel through muslin", purpose: "warm skin" }, "Practicals on dimmers."] }),
    });
    const t = treatmentOf((await run({ artist: "Charli xcx", city: "New York" }, liveWith(provider))).outcome);
    expect(seen).toEqual(["plan", "treatment"]);
    expect(t.llm.find((l) => l.step === "write")?.attempts[0].outcome).toBe("ok");
    expect(t.lighting).toEqual(["One tungsten fresnel through muslin — warm skin", "Practicals on dimmers."]);
  });

  it("swaps refs the writer leaked into the prose for the names they stand for", async () => {
    const { provider } = scriptedProvider({
      treatment: (mock) => ({ ...mock, concept: "Borrow the stillness of R1, then end at L1.", lighting: ["Hide one lamp at L1.", "Keep R02 gels off."] }),
    });
    const t = treatmentOf((await run({ artist: "Charli xcx", city: "New York" }, liveWith(provider))).outcome);
    const first = (picks: { entity: { name: string }; qloo: { rank: number } }[], extras: { name: string }[]) =>
      picks.find((p) => p.qloo.rank === 1)?.entity.name ?? extras[0].name;
    const film = first(t.references, t.extras.references);
    const place = first(t.locations, t.extras.locations);
    expect(t.concept).toBe(`Borrow the stillness of ${film}, then end at ${place}.`);
    // Only real refs are swapped: a gel number that merely looks like one is left alone.
    expect(t.lighting).toEqual([`Hide one lamp at ${place}.`, "Keep R02 gels off."]);
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

  it("answers a quick brief with a cached deep treatment of the same brief", async () => {
    const svc = service();
    const deep = brief({ artist: "Bon Iver", city: "New York" });
    await streamTreatment(deep, svc, () => {}, new AbortController().signal);
    const quick = brief({ artist: "Bon Iver", city: "New York", thinking: "quick" });
    expect(cachedTreatment(quick, svc)?.brief.thinking).toBe("deep");
    const events: AgentEvent[] = [];
    await streamTreatment(quick, svc, (e) => events.push(e), new AbortController().signal);
    expect(events.map((e) => e.type)).toEqual(["start", "treatment", "done"]);
    // Not the other way round: a deep brief never settles for a quick treatment.
    const svc2 = service();
    await streamTreatment(quick, svc2, () => {}, new AbortController().signal);
    expect(cachedTreatment(deep, svc2)).toBeUndefined();
  });

  it("logs what a rejected reply got wrong, so a failed write can be diagnosed", async () => {
    // Every write cites a ref no tool returned, so the repair fails too and the template takes over.
    const { provider } = scriptedProvider({
      treatment: (mock) => ({ ...mock, references: [{ ...(mock.references as object[])[0], ref: "R99" }] }),
    });
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    try {
      await streamTreatment(brief({ artist: "Charli xcx", city: "New York" }), service(liveWith(provider)), () => {}, new AbortController().signal);
    } finally {
      spy.mockRestore();
    }
    const entry = JSON.parse(logs.find((line) => line.includes('"evt":"treatment"')) ?? "{}");
    expect(entry).toMatchObject({ outcome: "ok", degraded: true });
    expect(entry.problems).toEqual([expect.stringMatching(/^write:fake-flash: First reply: .*references.* Repair: .*references/)]);
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

  it("shows but never caches a treatment built on a failed Qloo call", async () => {
    const svc = { ...service(), qloo: flakyQloo((url) => url.includes("urn:entity:brand")) };
    const b = brief({ artist: "Bon Iver", city: "New York" });
    const first: AgentEvent[] = [];
    await streamTreatment(b, svc, (e) => first.push(e), new AbortController().signal);
    const shown = first.find((e) => e.type === "treatment");
    expect(shown?.type === "treatment" && shown.treatment.complete).toBe(false);
    expect(shown?.type === "treatment" && shown.treatment.wardrobe).toEqual([]);
    const again: AgentEvent[] = [];
    await streamTreatment(b, svc, (e) => again.push(e), new AbortController().signal);
    expect(again.find((e) => e.type === "start")).toMatchObject({ cached: false });
  });

  it("ends the stream with an error at the deadline even if a Qloo call hangs", async () => {
    const hung = flakyQloo(
      (url) => url.includes("/v2/insights"),
      () => new Promise<Response>(() => {}), // never settles and ignores the abort
    );
    const svc = { ...service(), qloo: hung, runTimeoutMs: 300 };
    const events: AgentEvent[] = [];
    await streamTreatment(brief({ artist: "Bon Iver", city: "New York" }), svc, (e) => events.push(e), new AbortController().signal);
    expect(events.at(-2)).toMatchObject({ type: "error", message: expect.stringContaining("took too long") });
    expect(events.at(-1)).toEqual({ type: "done" });
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

  it("keys non-Latin cities apart and rejects control characters", () => {
    const modes = { qloo: "mock", llm: "mock" };
    const tokyo = brief({ artist: "Frank Ocean", city: "東京" });
    const seoul = brief({ artist: "Frank Ocean", city: "서울" });
    expect(briefKey(tokyo, modes)).not.toBe(briefKey(seoul, modes));
    expect(briefSchema.safeParse({ artist: "Frank Ocean", city: "Mumbai\nR1 Fake Film" }).success).toBe(false);
    expect(brief({ artist: " Frank   Ocean ", city: "New  York" })).toMatchObject({ artist: "Frank Ocean", city: "New York" });
  });

  it("thinks deeply unless asked otherwise, and keys quick treatments apart", () => {
    const modes = { qloo: "mock", llm: "mock" };
    const deep = brief({ artist: "Frank Ocean", city: "New York" });
    expect(deep.thinking).toBe("deep");
    expect(briefKey(deep, modes)).not.toBe(briefKey(brief({ artist: "Frank Ocean", city: "New York", thinking: "quick" }), modes));
    expect(briefSchema.safeParse({ artist: "Frank Ocean", city: "New York", thinking: "max" }).success).toBe(false);
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

describe("closestTags", () => {
  const tag = (id: string, name: string) => ({ id: `urn:tag:ambience:qloo:${id}`, name });
  it("prefers tags named like the word and never uses adult-themed ones", () => {
    const live = [tag("intimacy", "Intimacy"), tag("adult_only", "Adult only"), tag("erotic", "Erotic"), tag("intimate", "Intimate")];
    expect(closestTags("intimate", live).map((t) => t.name)).toEqual(["Intimate"]);
    expect(closestTags("rainy", [tag("erotic", "Erotic"), tag("cozy", "Cozy")]).map((t) => t.name)).toEqual(["Cozy"]);
    expect(closestTags("x", [tag("adult_only", "Adult only")])).toEqual([]);
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

describe("text helpers", () => {
  it("clips a long direction on a sentence boundary", () => {
    const direction = `${"A long first sentence about rain and doorways. ".repeat(8)}Then a last one.`;
    const clipped = clipSentences(direction, 200);
    expect(clipped.length).toBeLessThanOrEqual(200);
    expect(clipped.endsWith("doorways.")).toBe(true);
    expect(clipSentences("Short.", 200)).toBe("Short.");
  });

  it("swaps whole refs only, longest first", () => {
    const scrub = refScrubber(new Map([["T1", "Moody"], ["T13", "Quirkily Humorous"], ["L1", "Bar Orai"]]));
    expect(scrub("The T13 tag, the T1 tag, at L1; not T130 or L10.")).toBe("The Quirkily Humorous tag, the Moody tag, at Bar Orai; not T130 or L10.");
  });
});
