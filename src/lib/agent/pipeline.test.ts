import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Cooldowns, DailyBudget, LlmError, strictModeViolations, toJsonSchema, type LlmDeps, type LlmProvider } from "../llm";
import { QlooClient, createQlooClient, type FetchLike } from "../qloo";
import { MemoryCache } from "../qloo/cache";
import { mockEntityId } from "../qloo/mock/catalog";
import { createMockFetch } from "../qloo/mock/server";
import { briefKey, briefSchema, normalizeBrief, pickKey, priceLevelMax, type BriefInput } from "./brief";
import { RateLimiter, TtlCache, clientIp } from "./guards";
import { distanceM } from "../tools/heatmap";
import { cssString } from "../text";
import type { TmdbClient } from "../tmdb";
import { NONE_PICK, coverStill, excerpt, isIdentityTag, subjectPhrase, tagLabel, tmdbSize } from "./options";
import { clipSentences, closestTags, parseTitle, runPipeline, type PipelineOutcome } from "./pipeline";
import { describeBrief, planSchema } from "./plan";
import { cachedTreatment, streamTreatment, type TreatmentService } from "./service";
import type { AgentEvent, StepEvent } from "./types";
import { normalizeDraft, refScrubber, writeSchema, type WriteContext } from "./write";

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
    expect(t.writtenBy).toEqual({ provider: "mock", model: "itsgiving-template", mock: true });
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
    // The template writer puts its first film on the cover.
    expect(t.cover).toBe(t.references[0].entity.id);
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

  it("scores the director's own films for this audience, and tells the planner their order", async () => {
    const { provider, seen } = scriptedProvider({});
    const prompts: string[] = [];
    const recording: LlmProvider = {
      ...provider,
      async complete(call) {
        prompts.push(`${call.schemaName}: ${call.prompt}`);
        return provider.complete(call);
      },
    };
    const { outcome } = await run(
      { artist: "Prateek Kuhad", city: "Mumbai", director_films: ["In the Mood for Love", "Donnie Darko", "Rockstar"] },
      liveWith(recording),
    );
    const t = treatmentOf(outcome);
    const fit = t.directorFit ?? [];
    expect(fit.map((f) => f.entity.name).sort()).toEqual(t.director.map((d) => d.name).sort());
    expect(fit.map((f) => f.qloo.rank)).toEqual([1, 2, 3]);
    expect(fit.every((f) => f.qloo.tool === "score_for_audience" && f.qloo.of === 3)).toBe(true);
    // Qloo ranks exactly the films it was given, in the overlap step.
    const scoring = t.qloo.steps.overlap?.find((p) => p.query["filter.results.entities"]);
    expect(scoring?.query["filter.results.entities"]?.split(",").sort()).toEqual(t.director.map((d) => d.id).sort());
    const plan = prompts.find((p) => p.startsWith(`${seen[0]}:`)) ?? "";
    expect(plan).toContain(`Of the director's films, this audience likes, best first: ${fit[0].entity.name}`);
  });

  it("finds series beside the films, and cites them as references ranked among the series", async () => {
    const t = treatmentOf((await run({ artist: "Prateek Kuhad", city: "Mumbai" })).outcome);
    const queries = (t.qloo.steps.references ?? []).map((p) => p.query["filter.type"]);
    expect(queries).toEqual(expect.arrayContaining(["urn:entity:movie", "urn:entity:tv_show"]));
    const series = t.references.filter((r) => r.entity.kind === "tv_show");
    expect(series).toHaveLength(1);
    expect(series[0].qloo).toMatchObject({ tool: "reference_films", rank: 1 });
    expect(series[0].qloo.of).toBeLessThanOrEqual(6);
    // The cover is a film's still, never a series'.
    expect(t.references.find((r) => r.entity.id === t.cover)?.entity.kind).toBe("movie");
  });

  it("sketches the story's people, each with a different actor this audience knows as a reference", async () => {
    const { outcome, steps } = await run({ artist: "Prateek Kuhad", city: "Mumbai" });
    const t = treatmentOf(outcome);
    expect(t.casting).toBeUndefined();
    expect(t.characters).toHaveLength(3);
    for (const c of t.characters ?? []) {
      for (const line of [c.name, c.who, c.wants, c.hides, c.presence, c.look, c.arc]) expect(line).toBeTruthy();
      expect(c.beats.length).toBeGreaterThan(0);
      expect(c.beats.every((b) => b >= 1 && b <= t.beats.length)).toBe(true);
      // Mock films and actors aren't TMDB's: no character to draw from, no parts known.
      expect(c.from).toBeUndefined();
      expect(c.face?.known).toEqual([]);
    }
    const faces = (t.characters ?? []).flatMap((c) => (c.face ? [c.face] : []));
    expect(new Set(faces.map((f) => f.entity.id)).size).toBe(faces.length);
    for (const face of faces) {
      expect(face.entity.kind).toBe("person");
      expect(face.qloo).toMatchObject({ tool: "casting_references", rank: expect.any(Number), because: [{ name: "Prateek Kuhad" }] });
    }
    // Actors only, within an indie budget's reach, and never the YouTuber Qloo also tags as an actor.
    expect(t.qloo.steps.casting?.[0].query).toMatchObject({
      "filter.type": "urn:entity:person",
      "filter.tags": "urn:tag:genre:person:actor",
      "filter.popularity.max": "0.9",
    });
    const everyone = [...faces.map((f) => f.entity), ...(t.extras.people ?? [])];
    expect(everyone.every((e) => (e.popularity ?? 0) <= 0.9)).toBe(true);
    expect(everyone.map((e) => e.name)).not.toContain("Prajakta Koli");
    // An actor given a part isn't listed again among the others.
    expect((t.extras.people ?? []).filter((e) => faces.some((f) => f.entity.id === e.id))).toEqual([]);
    expect(steps.find((s) => s.id === "casting" && s.status !== "running")?.status).toBe("done");
  });

  it("draws the story's people from TMDB's characters, and names the parts their actors are known for", async () => {
    const mock = createMockFetch();
    // The mock's actors have no IMDb IDs: give each one, under imdb_id as live Qloo does. Qloo has no picture of the
    // second, and its image server no longer has the third's.
    const fetchImpl: FetchLike = async (url, init) => {
      const response = await mock(url, init);
      if (!decodeURIComponent(url).includes("filter.type=urn:entity:person")) return response;
      const body = await response.json();
      (body.results?.entities ?? []).forEach((e: { external?: unknown; properties?: { image?: unknown } }, i: number) => {
        e.external = { imdb_id: [{ id: `nm${1_000_000 + i}` }] };
        if (i === 1) delete e.properties?.image;
        if (i === 2) e.properties = { ...e.properties, image: { url: "https://images.qloo.com/i/gone.jpg" } };
      });
      return Response.json(body, { status: response.status });
    };
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("gone.jpg") ? new Response(null, { status: 307, headers: { location: "/s/oops.png" } }) : new Response("jpeg"),
    );
    onTestFinished(() => void vi.unstubAllGlobals());
    const live = new QlooClient({
      mode: "live",
      apiKey: "test",
      baseUrl: "https://mock.qloo.invalid",
      fetch: fetchImpl,
      cache: new MemoryCache(),
    });
    const asked: string[] = [];
    const tmdb = {
      configured: true,
      async find(imdb: string) {
        asked.push(imdb);
        return { kind: "movie", tmdbId: 1, still: `https://image.tmdb.org/t/p/w1280/${imdb}.jpg` };
      },
      async characters() {
        return [
          { name: "Shoko", actor: "Saori Hayami" },
          { name: "Shoya", actor: "Miyu Irino" },
        ];
      },
      async findPerson(imdb: string) {
        return { tmdbId: Number(imdb.slice(2)), photo: `https://image.tmdb.org/t/p/h632/${imdb}.jpg` };
      },
      async roles(person: { tmdbId: number }) {
        return person.tmdbId === 1_000_000 ? [{ character: "Calum", title: "Aftersun", year: 2022 }] : [];
      },
    } as unknown as TmdbClient;
    const short = brief({ touchstones: ["Past Lives", "Aftersun"], city: "Mumbai", format: "short_film" });
    const outcome = await runPipeline(short, { qloo: live, llm: mockLlm(), tmdb }, () => {}, {
      id: "test",
      signal: new AbortController().signal,
    });
    const t = treatmentOf(outcome);
    // A Silent Voice and Donnie Darko are the mock's films with IMDb IDs: each was asked about once.
    expect(asked).toContain("tt5323662");
    expect(new Set(asked).size).toBe(asked.length);
    const [lead] = t.characters ?? [];
    expect(lead.from).toMatchObject({ character: "Shoko", actor: "Saori Hayami", take: expect.any(String) });
    expect(["A Silent Voice", "Donnie Darko"]).toContain(lead.from?.title.name);
    expect((t.characters ?? []).flatMap((c) => c.face?.known ?? [])).toContainEqual({ character: "Calum", title: "Aftersun", year: 2022 });
    // TMDB's photo stands in only for the faces Qloo has no picture of, the one whose picture is gone included.
    const faces = (t.characters ?? []).flatMap((c) => (c.face ? [c.face] : []));
    expect(faces.filter((f) => f.photo).map((f) => [f.entity.image, f.photo])).toEqual([
      [undefined, "https://image.tmdb.org/t/p/h632/nm1000001.jpg"],
      [undefined, "https://image.tmdb.org/t/p/h632/nm1000002.jpg"],
    ]);
    // The stills come from the same lookups, and TMDB never makes a treatment partial.
    expect(
      t.references
        .filter((r) => r.entity.external?.imdb)
        .every((r) => r.still === `https://image.tmdb.org/t/p/w1280/${r.entity.external?.imdb}.jpg`),
    ).toBe(true);
    expect(t.complete).toBe(true);
  });

  it("lifts the popularity ceiling when too few actors are within a shoestring budget's reach", async () => {
    const t = treatmentOf((await run({ artist: "Prateek Kuhad", city: "Mumbai", budget: "shoestring" })).outcome);
    expect(t.qloo.steps.casting?.map((p) => p.query["filter.popularity.max"])).toEqual(["0.85", undefined]);
    expect(t.notes.join(" ")).toMatch(/Casting references: only \d matched at first, so itsgiving lifted the popularity ceiling/);
  });

  it("gives a short film music from what its audience plays, naming only songs Qloo lists for the artist", async () => {
    const { outcome, steps } = await run({ touchstones: ["Past Lives", "Aftersun"], city: "Mumbai", format: "short_film" });
    const t = treatmentOf(outcome);
    expect(t.music?.length).toBeGreaterThan(0);
    for (const m of t.music ?? []) {
      expect(m.entity.kind).toBe("artist");
      expect(m.notes.use).toBeTruthy();
      expect(m.qloo.tool).toBe("music_references");
      if (m.notes.song) expect(m.entity.artist?.songs).toContain(m.notes.song);
    }
    expect((t.music ?? []).some((m) => m.notes.song)).toBe(true);
    expect(steps.find((s) => s.id === "music" && s.status !== "running")?.credit?.kind).toBe("music");
  });

  it("drops a song the writer names that isn't on Qloo's list for that artist", async () => {
    const invented = (mock: Record<string, unknown>) => ({
      ...mock,
      music: (mock.music as { ref: string; use: string }[]).map((m) => ({ ...m, song: "A Song Nobody Wrote" })),
    });
    const { provider } = scriptedProvider({ treatment: invented });
    const { outcome } = await run({ touchstones: ["Past Lives", "Aftersun"], city: "Mumbai", format: "short_film" }, liveWith(provider));
    const t = treatmentOf(outcome);
    expect(t.music?.length).toBeGreaterThan(0);
    expect(t.music?.every((m) => m.notes.song === "")).toBe(true);
  });

  it("keeps a music video's music as evidence of what its audience plays, without writing it or billing it", async () => {
    const { outcome, steps } = await run({ artist: "Prateek Kuhad", city: "Mumbai" });
    const t = treatmentOf(outcome);
    expect(t.music).toBeUndefined();
    expect(t.extras.artists?.length).toBeGreaterThan(0);
    expect(t.extras.artists?.map((a) => a.name)).not.toContain("Prateek Kuhad");
    const music = steps.find((s) => s.id === "music" && s.status !== "running");
    expect(music?.status).toBe("done");
    expect(music?.credit).toBeUndefined();
  });

  it("leaves the scores out when there are no director films", async () => {
    const t = treatmentOf((await run({ artist: "Prateek Kuhad", city: "Mumbai" })).outcome);
    expect(t.directorFit).toBeUndefined();
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
    expect(t.notes.join(" ")).toMatch(/Locations: (nothing|only \d+) matched at first/);
  });

  it("bases the shoot where the audience over-indexes and scouts locations around it", async () => {
    const { outcome, steps } = await run({ artist: "Prateek Kuhad", city: "Mumbai" });
    const t = treatmentOf(outcome);
    const base = t.base!;
    expect(base.chosen).toBe("A1");
    expect(base.held).toBe(true);
    expect(base.areas.map((a) => a.ref)).toEqual(["A1", "A2", "A3"].slice(0, base.areas.length));
    expect(base.map?.tiles.length).toBeGreaterThan(20);
    const chosen = base.areas[0];
    expect(t.locations.length).toBeGreaterThanOrEqual(1);
    for (const l of [...t.locations.map((p) => p.entity), ...t.extras.locations]) {
      expect(distanceM(chosen, { lat: l.place!.lat!, lon: l.place!.lon! })).toBeLessThanOrEqual(chosen.radius_m);
    }
    expect(steps.find((s) => s.id === "heatmap" && s.status === "done")?.summary).toContain(chosen.name);
    expect(steps.find((s) => s.id === "locations" && s.status === "done")?.summary).toContain(`near ${chosen.name}`);
    // The city went to Qloo as its locality ID, not as a name to guess at.
    expect(t.qloo.steps.locations?.[0].query["filter.location"]).toMatch(/^POINT\(/);
    expect(t.qloo.steps.heatmap?.[0].query["filter.location"]).toMatch(/^00000000-/);
  });

  it("reads New York as the city, not the state Qloo lists first, and says so", async () => {
    const t = treatmentOf((await run({ artist: "Phoebe Bridgers", city: "New York" })).outcome);
    expect(t.notes.join(" ")).toContain(`first match for "New York" is the state`);
    expect(t.base?.areas.length).toBeGreaterThan(0);
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

describe("an artist Qloo doesn't have", () => {
  it("keeps the artist's name and reads the audience through stand-ins", async () => {
    const { outcome, steps } = await run({ artist: "Chaar Diwaari", stand_ins: ["Prateek Kuhad", "When Chai Met Toast"], city: "Mumbai" });
    const t = treatmentOf(outcome);
    expect(t.who).toEqual({ artists: ["Chaar Diwaari"], films: [], standIns: ["Prateek Kuhad", "When Chai Met Toast"] });
    expect(t.subjects.map((s) => s.name)).toEqual(["Prateek Kuhad", "When Chai Met Toast"]);
    expect(t.logline).toContain("for Chaar Diwaari");
    expect(t.notes).toContain(
      "Qloo doesn't have Chaar Diwaari, so the audience was read through Prateek Kuhad and When Chai Met Toast; the treatment keeps Chaar Diwaari's name.",
    );
    expect(steps.findLast((s) => s.id === "resolve")).toMatchObject({
      status: "warning",
      summary: expect.stringContaining("read through"),
    });
  });

  it("asks for stand-ins on their field when nothing else carries the audience", async () => {
    const none = await run({ artist: "Chaar Diwaari", city: "Mumbai" });
    expect(none.outcome).toMatchObject({ kind: "failed", field: "stand_ins", message: expect.stringContaining("Name up to 3 artists") });
    const unknown = await run({ artist: "Chaar Diwaari", stand_ins: ["Nobody Anyone Knows"], city: "Mumbai" });
    expect(unknown.outcome).toMatchObject({
      kind: "failed",
      field: "stand_ins",
      message: expect.stringContaining("or Nobody Anyone Knows"),
    });
  });

  it("doesn't use stand-ins when Qloo has the artist", async () => {
    const t = treatmentOf((await run({ artist: "Prateek Kuhad", stand_ins: ["Divine"], city: "Mumbai" })).outcome);
    expect(t.subjects.map((s) => s.name)).toEqual(["Prateek Kuhad"]);
    expect(t.notes).toContain("Qloo has Prateek Kuhad, so the stand-in artists weren't needed.");
  });

  it("offers None of these for near misses, then builds from the films without the artist", async () => {
    const first = await run({ artist: "Prateek", touchstones: ["Masaan"], city: "Mumbai" });
    if (first.outcome.kind !== "needs_input") throw new Error(`expected a question, got ${first.outcome.kind}`);
    const [question] = first.outcome.items;
    expect(question).toMatchObject({ role: "artist", exact: false, candidates: [{ name: "Prateek Kuhad" }] });
    expect(first.outcome.message).toContain("nothing under these exact names");

    const none = await run({ artist: "Prateek", touchstones: ["Masaan"], city: "Mumbai", picks: { [question.key]: NONE_PICK } });
    const t = treatmentOf(none.outcome);
    expect(t.who?.artists).toEqual(["Prateek"]);
    expect(t.subjects.map((s) => s.name)).toEqual(["Masaan"]);
    expect(t.notes).toContain("Qloo doesn't have Prateek, so the audience was read from the reference films alone.");
  });

  it("reads a musician Qloo files only as a person", async () => {
    const t = treatmentOf((await run({ artist: "Raftaar", city: "Mumbai" })).outcome);
    expect(t.subjects[0]).toMatchObject({ name: "Raftaar", kind: "person" });
    expect(t.who?.artists).toEqual(["Raftaar"]);
    expect(t.notes.join(" ")).toContain("as a person");
  });

  it("tells the model what Qloo couldn't supply, outside the user's brief", () => {
    const prompt = describeBrief(brief({ artist: "Chaar Diwaari", stand_ins: ["Prateek Kuhad"], city: "Mumbai" }), {
      artistNames: ["Chaar Diwaari"],
      touchstoneNames: [],
      directorNames: [],
      standInNames: ["Prateek Kuhad"],
      artistMissing: true,
    });
    expect(prompt.indexOf("NOTE")).toBeGreaterThan(prompt.indexOf("shoot city"));
    expect(prompt).toContain("artists with a similar audience the director named: Prateek Kuhad");
  });
});

describe("a short film", () => {
  it("is after its films, and its artist only says whose fans it's for", async () => {
    const b = brief({ format: "short_film", artist: "Prateek Kuhad", touchstones: ["Masaan"], city: "Mumbai" });
    const prompt = describeBrief(b, { artistNames: ["Prateek Kuhad"], touchstoneNames: ["Masaan (2015)"], directorNames: [] });
    expect(prompt).toContain("music its audience loves: Prateek Kuhad");
    expect(prompt).not.toContain("artist: ");
    expect(subjectPhrase(["Prateek Kuhad"], ["Masaan"], "short_film")).toBe("after Masaan, for fans of Prateek Kuhad");

    const t = treatmentOf((await run({ format: "short_film", artist: "Prateek Kuhad", touchstones: ["Masaan"], city: "Mumbai" })).outcome);
    expect(t.who).toEqual({ artists: ["Prateek Kuhad"], films: ["Masaan"], standIns: [] });
    // The template writer, too, writes a lead and a story, not a performer and a song.
    expect(`${t.concept} ${t.beats.map((beat) => beat.description).join(" ")}`).not.toMatch(/performer|song|the artist/);
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

  it("logs each failed Qloo call, and how it failed, when a treatment comes back incomplete", async () => {
    const lines: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((line: string) => void lines.push(line));
    try {
      for (const [id, fails] of [
        ["partial", (url: string) => url.includes("urn:entity:brand")],
        ["whole", () => false],
      ] as const) {
        const outcome = await runPipeline(
          brief({ artist: "Bon Iver", city: "New York" }),
          { qloo: flakyQloo(fails), llm: mockLlm() },
          () => {},
          { id, signal: new AbortController().signal },
        );
        expect(treatmentOf(outcome).complete).toBe(id === "whole");
      }
    } finally {
      warn.mockRestore();
    }
    const logged = lines.filter((line) => line.includes('"evt":"qloo_failed"')).map((line) => JSON.parse(line));
    // Only the partial run says why: every call about brands (the wardrobe's tag search, then the brands themselves)
    // got Qloo's 503, named by its kind, without Qloo's own words.
    expect(logged).toEqual([{ evt: "qloo_failed", id: "partial", failed: expect.any(Array) }]);
    expect(new Set(logged[0].failed)).toEqual(new Set(["tags:find_tags=upstream", "wardrobe:styling_brands=upstream"]));
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
    // The faces need only the names: a re-plan doesn't look for them again.
    expect(steps.filter((s) => s.id === "casting" && s.status !== "running")).toHaveLength(1);
    expect(t.qloo.steps.casting).toHaveLength(1);
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

  it("lets the planner pick the shoot base, and widens to the city when too few places are near it", async () => {
    const prompts: string[] = [];
    const { provider } = scriptedProvider({ plan: (mock) => ({ ...mock, base: "A2" }) });
    const recording: LlmProvider = { ...provider, complete: (call) => (prompts.push(call.prompt), provider.complete(call)) };
    const t = treatmentOf((await run({ artist: "Prateek Kuhad", city: "Mumbai" }, liveWith(recording))).outcome);
    expect(prompts[0]).toContain("WHERE THE AUDIENCE IS (Qloo heatmap of Mumbai, strongest first)");
    expect(prompts[0]).toMatch(/A2 \S/);
    const base = t.base!;
    const juhu = base.areas.find((a) => a.ref === "A2")!;
    // Juhu has one mock cafe: too few to base a shoot on, so the search widens and the writer isn't told of a base.
    expect(base).toMatchObject({ chosen: "A2", held: false });
    expect(t.notes.join(" ")).toContain(`only 1 matched at first, so itsgiving widened the search from ${juhu.name} to all of Mumbai`);
    expect(prompts.at(-1)).not.toContain("Shoot base:");
    expect(t.locations.length).toBeGreaterThan(1);
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
      treatment: (mock) => ({
        ...mock,
        lighting: [{ setup: "One tungsten fresnel through muslin", purpose: "warm skin" }, "Practicals on dimmers."],
      }),
    });
    const t = treatmentOf((await run({ artist: "Charli xcx", city: "New York" }, liveWith(provider))).outcome);
    expect(seen).toEqual(["plan", "treatment"]);
    expect(t.llm.find((l) => l.step === "write")?.attempts[0].outcome).toBe("ok");
    expect(t.lighting).toEqual(["One tungsten fresnel through muslin — warm skin", "Practicals on dimmers."]);
  });

  it("puts the cover on the cited film the writer chose, and on none it left uncited", async () => {
    const choosing = (cover: (cited: { ref: string }[]) => string | null) =>
      liveWith(scriptedProvider({ treatment: (mock) => ({ ...mock, cover: cover(mock.references as { ref: string }[]) }) }).provider);
    const second = treatmentOf(
      (
        await run(
          { artist: "Charli xcx", city: "New York" },
          choosing((cited) => cited[1].ref),
        )
      ).outcome,
    );
    expect(second.cover).toBe(second.references[1].entity.id);
    // The template cites the first four of more candidates, so R5 is a film Qloo returned that the board doesn't show.
    expect(second.extras.references.length).toBeGreaterThan(0);
    const uncited = treatmentOf(
      (
        await run(
          { artist: "Charli xcx", city: "New York" },
          choosing(() => "R5"),
        )
      ).outcome,
    );
    expect(uncited.llm.find((l) => l.step === "write")?.attempts[0].outcome).toBe("ok");
    expect(uncited.cover).toBeUndefined();
  });

  it("swaps refs the writer leaked into the prose for the names they stand for", async () => {
    const { provider } = scriptedProvider({
      treatment: (mock) => ({
        ...mock,
        concept: "Borrow the stillness of R1, then end at L1.",
        lighting: ["Hide one lamp at L1.", "Keep R02 gels off."],
      }),
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
      await streamTreatment(
        brief({ artist: "Charli xcx", city: "New York" }),
        service(liveWith(provider)),
        () => {},
        new AbortController().signal,
      );
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
    await streamTreatment(
      brief({ touchstones: ["Forgotten"], city: "Mumbai" }),
      service(),
      (e) => events.push(e),
      new AbortController().signal,
    );
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
      series: [{ ref: "S1", item: entity }],
      characters: [{ ref: "C1", item: { title: entity, name: "Anna", actor: "Jessie Buckley" } }],
      casting: [{ ref: "P1", item: entity }],
      music: [{ ref: "M1", item: entity }],
      brands: [{ ref: "B1", item: entity }],
      places: [{ ref: "L1", item: entity }],
    } as unknown as WriteContext;
    expect(strictModeViolations(toJsonSchema(planSchema(["T1", "T2"])))).toEqual([]);
    expect(strictModeViolations(toJsonSchema(planSchema([])))).toEqual([]);
    expect(strictModeViolations(toJsonSchema(planSchema(["T1"], ["A1", "A2"])))).toEqual([]);
    expect(strictModeViolations(toJsonSchema(writeSchema(ctx)))).toEqual([]);
    // Nothing to cite: the people's sources and faces can only be null.
    expect(strictModeViolations(toJsonSchema(writeSchema({ ...ctx, characters: [], casting: [] })))).toEqual([]);
  });

  it("give a draft with films but no cover pick an empty one, rather than spend a repair call on it", () => {
    expect(normalizeDraft({ title: "T", references: [] })).toEqual({ title: "T", references: [], cover: null, characters: [] });
    expect(normalizeDraft({ references: [], cover: "R2" })).toEqual({ references: [], cover: "R2", characters: [] });
    // No films, no cover field: the schema has none to accept.
    expect(normalizeDraft({ title: "T" })).toEqual({ title: "T", characters: [] });
  });

  it("give a character left without a source, a face or its beats empty ones, and read beats sent as words", () => {
    const person = { name: "Ira", who: "w", wants: "w", hides: "h", presence: "p", look: "l", arc: "a" };
    expect(normalizeDraft({ characters: [person] })).toEqual({ characters: [{ ...person, from: null, take: "", face: null, beats: [] }] });
    const sent = { ...person, from: "C2", take: "Her stillness.", face: "P1", beats: [1, "3", "Beat 4", "the end"] };
    expect(normalizeDraft({ characters: [sent] })).toEqual({ characters: [{ ...sent, beats: [1, 3, 4, "the end"] }] });
  });

  it("only let the planner base the shoot in an area the heatmap returned", () => {
    const plan = {
      direction: "A quiet film about leaving.",
      tone: ["T1"],
      deep_cuts: "balanced",
      wardrobe_words: ["vintage"],
      ambience_words: ["cozy"],
      venue_kinds: ["cafe"],
    };
    const schema = planSchema(["T1"], ["A1", "A2"]);
    expect(schema.safeParse({ ...plan, base: "A2" }).success).toBe(true);
    expect(schema.safeParse({ ...plan, base: "A3" }).success).toBe(false);
    expect(schema.safeParse(plan).success).toBe(false);
    // No heatmap, no base field at all.
    expect(planSchema(["T1"]).safeParse(plan).success).toBe(true);
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

  it("says whether a key is at its limit without counting a hit", () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect(limiter.full("a")).toBe(false);
    limiter.check("a");
    expect(limiter.full("a")).toBe(false);
    expect(limiter.full("a")).toBe(false); // looking twice didn't use the second hit
    limiter.check("a");
    expect(limiter.full("a")).toBe(true);
    expect(limiter.full("b")).toBe(false);
    now = 1001;
    expect(limiter.full("a")).toBe(false);
  });

  it("keeps at most its budget of keys, forgetting the least recently seen", () => {
    const limiter = new RateLimiter(1, 1000, () => 0, 3);
    for (const key of ["a", "b", "c"]) limiter.check(key);
    expect(limiter.check("a").ok).toBe(false); // refused, but seen again: now the most recent
    limiter.check("d"); // a fourth key: "b", the least recently seen, goes
    expect(limiter.full("b")).toBe(false);
    expect(["a", "c", "d"].map((key) => limiter.full(key))).toEqual([true, true, true]);
  });

  it("counts an IPv4 client whole and an IPv6 client by its /64", () => {
    const key = (forwarded: string) => clientIp(new Headers({ "x-forwarded-for": forwarded }));
    expect(key("203.0.113.9, 10.0.0.1")).toBe("203.0.113.9");
    expect(key("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(key("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:85a3:0::/64");
    expect(key("2001:0DB8:85a3:0000:1111:8a2e:0370:7334")).toBe("2001:db8:85a3:0::/64");
    expect(key("2001:db8:85a3:0:ffff::1")).toBe(key("2001:db8:85a3::2")); // one /64, any host part
    expect(key("2001:db8:85a4::1")).not.toBe(key("2001:db8:85a3::1"));
    expect(key("::1")).toBe("0:0:0:0::/64");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("unknown");
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

  it("makes excerpts that end on a sentence, or on a word with an ellipsis", () => {
    const note = "The atmosphere is nostalgic and vintage. Guests can enjoy a quiet, authentic dining experience by the window.";
    expect(excerpt(note, 60)).toBe("The atmosphere is nostalgic and vintage.");
    expect(excerpt("A long run of words without any full stop in it at all", 30)).toBe("A long run of words without…");
    expect(excerpt("Quiet, warm; welcoming staff", 14)).toBe("Quiet, warm…");
    expect(excerpt(note, 500)).toBe(note);
  });

  it("writes any title as a CSS string that keeps its own spaces", () => {
    // Each escape ends in a space, which CSS reads as the escape's end, so a space after a comma or a full stop stays.
    expect(cssString("Almost, In Bandra")).toBe('"Almost\\2c  In Bandra"');
    expect(cssString("Kurla, 2 A.M.")).toBe('"Kurla\\2c  2 A\\2e M\\2e "');
    expect(cssString('A "quote" \\ here')).toBe('"A \\22 quote\\22  \\5c  here"');
  });

  it("swaps whole refs only, longest first", () => {
    const scrub = refScrubber(
      new Map([
        ["T1", "Moody"],
        ["T13", "Quirkily Humorous"],
        ["L1", "Bar Orai"],
      ]),
    );
    expect(scrub("The T13 tag, the T1 tag, at L1; not T130 or L10.")).toBe(
      "The Quirkily Humorous tag, the Moody tag, at Bar Orai; not T130 or L10.",
    );
  });
});

describe("director taste import", () => {
  it("adds imported films (by IMDb ID) to the taste comparison and notes the ones Qloo lacks", async () => {
    const { outcome } = await run({
      artist: "Prateek Kuhad",
      city: "Mumbai",
      director_films: ["In the Mood for Love"],
      director_imdb_ids: ["tt0246578", "tt0114369", "tt7180392"],
    });
    const t = treatmentOf(outcome);
    expect(t.director.map((e) => e.name)).toEqual(["In the Mood for Love", "Se7en", "Donnie Darko"]);
    expect(t.qloo.steps.resolve?.some((p) => p.path === "/entities")).toBe(true);
    const groupA = t.qloo.steps.overlap?.[0]?.query["a.signal.interests.entities"] ?? "";
    for (const name of ["In the Mood for Love", "Donnie Darko", "Se7en"]) expect(groupA).toContain(mockEntityId(name));
    expect(t.notes).toContain("1 of your imported films isn't in Qloo's catalog, so it was left out.");
  });

  it("keys stand-ins only when there are some, in any order", () => {
    const base = { artist: "Chaar Diwaari", city: "Mumbai" };
    const modes = { qloo: "mock", llm: "mock" };
    expect(briefKey(brief({ ...base, stand_ins: [] }), modes)).toBe(briefKey(brief(base), modes));
    const key = briefKey(brief({ ...base, stand_ins: ["Divine", "Prateek Kuhad"] }), modes);
    expect(briefKey(brief({ ...base, stand_ins: ["Prateek Kuhad", "Divine", "divine"] }), modes)).toBe(key);
    expect(key).not.toBe(briefKey(brief(base), modes));
    expect(briefSchema.safeParse({ ...base, stand_ins: ["A", "B", "C", "D"] }).success).toBe(false);
  });

  it("keeps a brief's cache key when nothing is imported, and ignores import order and repeats", () => {
    const base = { artist: "Prateek Kuhad", city: "Mumbai" };
    const modes = { qloo: "mock", llm: "mock" };
    expect(briefKey(brief({ ...base, director_imdb_ids: [] }), modes)).toBe(briefKey(brief(base), modes));
    const key = briefKey(brief({ ...base, director_imdb_ids: ["tt0246578", "tt0114369"] }), modes);
    expect(briefKey(brief({ ...base, director_imdb_ids: ["tt0114369", "tt0246578", "tt0114369"] }), modes)).toBe(key);
    expect(key).not.toBe(briefKey(brief(base), modes));
    expect(briefSchema.safeParse({ ...base, director_imdb_ids: ["nm0000123"] }).success).toBe(false);
  });
});

describe("identity tags, tag labels and stills", () => {
  it("keeps tags that name who people are out of tone and evidence", () => {
    for (const name of ["lesbian", "LGBT", "LGBTQ+ Themes", "Queer", "gay", "Christianity", "depression"]) {
      expect(isIdentityTag(name), name).toBe(true);
    }
    for (const name of ["dark comedy", "black comedy", "Bollywood", "Confessional", "teenager", "female protagonist", "R&B", "Christmas"]) {
      expect(isIdentityTag(name), name).toBe(false);
    }
    expect(closestTags("queer", [{ id: "urn:tag:keyword:qloo:queer", name: "Queer" }])).toEqual([]);
  });

  it("puts all-lowercase tags in title case and leaves capitalized ones alone", () => {
    expect(tagLabel("new york city")).toBe("New York City");
    expect(tagLabel("coming of age")).toBe("Coming of Age");
    expect(tagLabel("synth-driven")).toBe("Synth-driven");
    expect(tagLabel("Quirkily Humorous")).toBe("Quirkily Humorous");
    expect(tagLabel("R&B")).toBe("R&B");
  });

  it("sizes TMDB images and takes the cover's still from the writer's pick, else the first reference with one", () => {
    expect(tmdbSize("https://image.tmdb.org/t/p/w1280/a.jpg", "w780")).toBe("https://image.tmdb.org/t/p/w780/a.jpg");
    expect(tmdbSize("https://image.tmdb.org/t/p/w1280/a.jpg", "w300")).toBe("https://image.tmdb.org/t/p/w300/a.jpg");
    const ref = (id: string, still?: string) => ({ entity: { id }, ...(still ? { still } : {}) });
    const references = [ref("a"), ref("b", "s2"), ref("c", "s3")];
    expect(coverStill({ references })).toBe("s2");
    expect(coverStill({ cover: "c", references })).toBe("s3");
    // A pick TMDB had no still for falls back like a treatment built before the writer picked.
    expect(coverStill({ cover: "a", references })).toBe("s2");
    expect(coverStill({ references: [ref("a")] })).toBeUndefined();
  });
});
