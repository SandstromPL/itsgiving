import { describe, expect, it } from "vitest";
import { Cooldowns, DailyBudget, LlmError, type LlmDeps, type LlmProvider } from "../llm";
import { QlooClient, type FetchLike } from "../qloo";
import { MemoryCache } from "../qloo/cache";
import { createMockFetch } from "../qloo/mock/server";
import { briefSchema, normalizeBrief, type BriefInput } from "./brief";
import { isIdentityTag } from "./options";
import { runPipeline } from "./pipeline";
import type { CreditKind, StepEvent } from "./types";

// Live Qloo files some film themes under who people are, and can rank them first ("LGBT", "lesbian"). Here every tag
// list the mock returns leads with two, so the credits are checked against tags that were really there to leave out.
const IDENTITY_TAGS = [
  { tag_id: "urn:tag:keyword:media:lgbt", name: "LGBT", subtype: "urn:tag:keyword:media", query: { affinity: 0.99, score: 0.99 } },
  { tag_id: "urn:tag:keyword:media:lesbian", name: "lesbian", subtype: "urn:tag:keyword:media", query: { affinity: 0.98, score: 0.98 } },
];

function identityFirstQloo(led: Set<string>) {
  const mock = createMockFetch();
  const fetchImpl: FetchLike = async (url, init) => {
    const response = await mock(url, init);
    const body = await response.json();
    if (Array.isArray(body?.results?.tags)) {
      body.results.tags = [...IDENTITY_TAGS, ...body.results.tags];
      led.add(new URL(url).pathname);
    }
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  };
  return new QlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid", fetch: fetchImpl, cache: new MemoryCache(), maxAttempts: 1 });
}

const mockLlm = (): LlmDeps => ({ mode: "mock", providers: [], budget: new DailyBudget(100), timeoutMs: 1000, cooldowns: new Cooldowns() });
const liveWith = (provider: LlmProvider): LlmDeps => ({
  mode: "live",
  providers: [provider],
  budget: new DailyBudget(100),
  timeoutMs: 1000,
  cooldowns: new Cooldowns(),
});

async function run(input: BriefInput, llm: LlmDeps = mockLlm()) {
  const led = new Set<string>();
  const steps: StepEvent[] = [];
  const outcome = await runPipeline(
    normalizeBrief(briefSchema.parse(input)),
    { qloo: identityFirstQloo(led), llm },
    (event) => void (event.type === "step" && steps.push(event)),
    { id: "credits", signal: new AbortController().signal },
  );
  if (outcome.kind !== "treatment") throw new Error(`expected a treatment, got ${outcome.kind}`);
  return { treatment: outcome.treatment, steps, credited: steps.filter((s) => s.credit), led };
}

const ALL_KINDS: CreditKind[] = ["subject", "audience", "base", "style", "films", "brands", "places"];

describe("the run's opening credits", () => {
  it("bill every kind on a mock run, Qloo's own names only and never a tag that says who people are", async () => {
    const {
      treatment: t,
      credited,
      led,
    } = await run({ artist: "Prateek Kuhad", city: "Mumbai", director_films: ["In the Mood for Love"] });
    // The identity tags led the audience read, the overlap and every tag search.
    expect([...led].sort()).toEqual(["/v2/analysis/compare", "/v2/insights", "/v2/tags"]);

    expect(new Set(credited.map((s) => s.credit?.kind))).toEqual(new Set(ALL_KINDS));
    for (const step of credited) {
      expect(["done", "warning"]).toContain(step.status);
      expect(step.credit?.names.length).toBeGreaterThan(0);
      expect(step.credit?.names.length).toBeLessThanOrEqual(3);
      expect(step.credit?.names.filter(isIdentityTag)).toEqual([]);
    }

    const names = (kind: CreditKind) => credited.find((s) => s.credit?.kind === kind)?.credit?.names ?? [];
    expect(names("subject")).toEqual(["Prateek Kuhad"]);
    // The audience's top three tags once the identity tags are out: what the treatment's audience section leads with.
    expect(names("audience")).toEqual(t.audience.taste_tags.slice(0, 3).map((tag) => tag.name));
    expect(names("base")).toEqual([t.base?.areas.find((a) => a.ref === t.base?.chosen)?.name]);
    // Films, brands and places are Qloo's first three: cited on the board, or kept there as extras.
    const onBoard = (picks: { entity: { name: string } }[], extras: { name: string }[]) => [
      ...picks.map((p) => p.entity.name),
      ...extras.map((e) => e.name),
    ];
    expect(onBoard(t.references, t.extras.references)).toEqual(expect.arrayContaining(names("films")));
    expect(onBoard(t.wardrobe, t.extras.brands)).toEqual(expect.arrayContaining(names("brands")));
    expect(onBoard(t.locations, t.extras.locations)).toEqual(expect.arrayContaining(names("places")));
    // Each comes on the step that found it; the base comes with the plan that chose it.
    expect(Object.fromEntries(credited.map((s) => [s.credit?.kind, s.id]))).toEqual({
      subject: "resolve",
      audience: "audience",
      base: "plan",
      style: "tags",
      films: "references",
      brands: "wardrobe",
      places: "locations",
    });
  });

  it("bill an artist Qloo doesn't have as read through the stand-ins", async () => {
    const { credited } = await run({ artist: "Chaar Diwaari", stand_ins: ["Prateek Kuhad", "When Chai Met Toast"], city: "Mumbai" });
    const subject = credited.find((s) => s.credit?.kind === "subject");
    expect(subject).toMatchObject({ status: "warning" });
    expect(subject?.credit).toEqual({ kind: "subject", names: ["Prateek Kuhad", "When Chai Met Toast"], standInFor: "Chaar Diwaari" });
  });

  it("come again, updated, from the steps a re-plan runs again", async () => {
    // The first plan's style words find no tags, so the re-plan (the template's words here) runs the searches again.
    const nonsense: LlmProvider = {
      kind: "gemini",
      model: "fake-flash",
      async complete(call) {
        const mock = call.mock() as Record<string, unknown>;
        const answer = call.schemaName === "plan" ? { ...mock, wardrobe_words: ["qwxzv"], ambience_words: ["zzvqx"] } : mock;
        return { text: JSON.stringify(answer) };
      },
    };
    const { treatment: t, steps } = await run({ artist: "Frank Ocean", city: "New York" }, liveWith(nonsense));
    expect(t.llm.map((l) => l.step)).toEqual(["plan", "replan", "write"]);
    const kinds = (id: StepEvent["id"]) => steps.filter((s) => s.id === id && s.status !== "running").map((s) => s.credit?.kind);
    // No style tags the first time, then some.
    expect(kinds("tags")).toEqual([undefined, "style"]);
    expect(kinds("references")).toEqual(["films", "films"]);
    expect(kinds("plan")).toEqual(["base"]);
    expect(kinds("replan")).toEqual(["base"]);
  });

  it("bill nothing for a model step only the template answered, and still bill what Qloo found", async () => {
    const down: LlmProvider = {
      kind: "groq",
      model: "down",
      complete: async () => {
        throw new LlmError({ kind: "rate_limit", message: "429", provider: "groq", model: "down", status: 429 });
      },
    };
    const { steps, credited } = await run({ artist: "Lana Del Rey", city: "New York" }, liveWith(down));
    expect(steps.findLast((s) => s.id === "plan")).toMatchObject({ status: "warning", credit: undefined });
    expect(credited.map((s) => s.credit?.kind)).not.toContain("base");
    expect(credited.map((s) => s.credit?.kind)).toEqual(expect.arrayContaining(["subject", "audience", "films", "brands", "places"]));
  });
});
