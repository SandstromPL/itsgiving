import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formFromBrief, toBrief } from "@/app/studio/form";
import { Cooldowns, DailyBudget } from "../llm";
import { QlooClient } from "../qloo";
import { MemoryCache } from "../qloo/cache";
import { briefKey, briefSchema, normalizeBrief, type BriefInput } from "./brief";
import { EXAMPLES } from "./examples";
import { featuredCovers, featuredReplay, loadFeatured, type FeaturedItem } from "./featured";
import { RateLimiter, TtlCache } from "./guards";
import { cachedTreatment, type TreatmentService } from "./service";
import type { Treatment } from "./types";

const brief = (input: BriefInput) => normalizeBrief(briefSchema.parse(input));
const modes = { qloo: "live", llm: "live" };

/** Just enough of a treatment for lookups and covers. */
function fakeTreatment(input: BriefInput, title = "Almost, Every Evening"): Treatment {
  return {
    title,
    logline: "Two people keep almost meeting.",
    brief: brief({ ...input, thinking: "deep" }),
    subjects: [{ id: "a1", name: input.artist ?? "Someone", kind: "artist", tags: [] }],
    palette: [{ name: "Ink", hex: "#0A0908" }],
    references: [{ entity: { id: "f1", name: "Mimi", kind: "movie", tags: [], image: "https://img.example/mimi.jpg" } }],
    tone: [{ tag: { id: "urn:tag:keyword:qloo:introspective", name: "Introspective" }, source: "audience", note: "Quiet." }],
  } as unknown as Treatment;
}

function service(mode: "live" | "mock", items: FeaturedItem[]): TreatmentService {
  return {
    qloo: new QlooClient({
      mode,
      apiKey: "test",
      baseUrl: "https://qloo.invalid",
      fetch: () => Promise.reject(new Error("no network in tests")),
      cache: new MemoryCache(),
      maxAttempts: 1,
    }),
    llm: { mode, providers: [], budget: new DailyBudget(10), timeoutMs: 1000, cooldowns: new Cooldowns() },
    cache: new TtlCache(10, 60_000),
    limiter: new RateLimiter(5, 60_000),
    featured: () => items,
  };
}

describe("featured examples", () => {
  it("make the same brief from the form as the featured script builds, so they open from the pre-built set", () => {
    for (const example of EXAMPLES) {
      const built = brief({ ...example.brief, thinking: "deep" });
      const fromForm = brief(toBrief(formFromBrief(example.brief)));
      expect(briefKey(fromForm, modes), example.slug).toBe(briefKey(built, modes));
    }
  });

  it("answers a live brief from the pre-built set, a quick one too, and never a mock run", () => {
    const input = EXAMPLES[0].brief;
    const featured = fakeTreatment(input);
    const live = service("live", [{ slug: EXAMPLES[0].slug, treatment: featured }]);
    expect(cachedTreatment(brief(input), live)).toBe(featured);
    expect(cachedTreatment(brief({ ...input, thinking: "quick" }), live)).toBe(featured);
    expect(cachedTreatment(brief({ ...input, city: "Delhi" }), live)).toBeUndefined();
    expect(cachedTreatment(brief(input), service("mock", [{ slug: EXAMPLES[0].slug, treatment: featured }]))).toBeUndefined();
  });

  it("reads nothing from a missing or malformed file, and only well-formed items from a good one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "itsgiving-featured-"));
    expect(loadFeatured(path.join(dir, "missing.json"))).toEqual([]);
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(loadFeatured(bad)).toEqual([]);
    const good = path.join(dir, "good.json");
    const item = { slug: "prateek-kuhad-mumbai", treatment: fakeTreatment(EXAMPLES[0].brief) };
    writeFileSync(good, JSON.stringify({ generatedAt: "2026-10-25T00:00:00Z", items: [item, { slug: "broken" }] }));
    expect(loadFeatured(good).map((i) => i.slug)).toEqual(["prateek-kuhad-mumbai"]);
  });

  it("cuts a featured run with a heatmap down to the landing's replay", () => {
    const qloo = (tool: string, rank: number, of: number, affinity: number) => ({ tool, rank, of, affinity, tags: [], because: [] });
    const run = {
      ...fakeTreatment(EXAMPLES[0].brief),
      mock: { qloo: false, llm: false },
      audience: {
        taste_tags: [{ id: "urn:tag:genre:music:indie_folk", name: "Indie folk" }],
        overlap: [],
        leans: ["over-indexes 30 to 34, skews female"],
      },
      base: {
        chosen: "A2",
        held: true,
        areas: [
          { ref: "A1", rank: 1, name: "Churchgate", near: [], lat: 18.93, lon: 72.83, radius_m: 2000, share: 0.3 },
          { ref: "A2", rank: 2, name: "Bandra West", near: [], lat: 19.06, lon: 72.83, radius_m: 2000, share: 0.2 },
        ],
        map: {
          bounds: { south: 19, west: 72.8, north: 19.1, east: 72.9 },
          cell: { lat: 0.01, lon: 0.01 },
          tiles: [
            { lat: 19.005, lon: 72.805, heat: 0.2 },
            { lat: 19.005, lon: 72.815, heat: 0.9 },
            { lat: 19.015, lon: 72.805, heat: 0.5 },
            { lat: 19.055, lon: 72.835, heat: 1 },
          ],
        },
      },
      references: [
        { entity: { id: "f2", name: "Jalsa", year: 2022, kind: "movie", tags: [] }, qloo: qloo("reference_films", 7, 10, 0.939) },
        { entity: { id: "f1", name: "Darlings", year: 2022, kind: "movie", tags: [] }, qloo: qloo("reference_films", 2, 10, 0.945) },
      ],
      wardrobe: [{ entity: { id: "b1", name: "Suta", kind: "brand", tags: [] }, qloo: qloo("wardrobe_brands", 2, 8, 0.988) }],
      locations: [
        {
          entity: { id: "p1", name: "The Bad Cafe", kind: "place", tags: [], place: { lat: 19.06, lon: 72.8239 } },
          qloo: qloo("scout_locations", 2, 8, 0.733),
        },
      ],
      qloo: { mode: "live", calls: 21, steps: {} },
      llm: [{ step: "plan" }, { step: "write" }],
      writtenBy: { provider: "deepseek", model: "deepseek-flash", mock: false },
    } as unknown as Treatment;
    const plain = { slug: "charli-xcx-new-york", treatment: fakeTreatment(EXAMPLES[1].brief) };

    expect(featuredReplay([plain])).toBeUndefined();
    const replay = featuredReplay([plain, { slug: "prateek-kuhad-mumbai", treatment: run }]);
    expect(replay).toMatchObject({
      slug: "prateek-kuhad-mumbai",
      subject: "Prateek Kuhad",
      city: "Mumbai",
      leans: "over-indexes 30 to 34, skews female",
      radiusKm: 2,
      held: true,
      qlooCalls: 21,
      modelCalls: 2,
      writtenBy: "deepseek-flash",
      tags: ["Introspective", "Indie folk"],
    });
    expect(replay?.areas.map((a) => [a.name, a.chosen])).toEqual([
      ["Bandra West", true],
      ["Churchgate", false],
    ]);
    // The best-ranked film, brand and place, the place with its distance from the base.
    expect(replay?.receipts).toEqual([
      { kind: "film", name: "Darlings (2022)", rank: 2, of: 10, affinity: 0.945 },
      { kind: "brand", name: "Suta", rank: 2, of: 8, affinity: 0.988 },
      { kind: "place", name: "The Bad Cafe", rank: 2, of: 8, affinity: 0.733, km: 0.6 },
    ]);
    // Three of the four tiles share a 2x2 block, and the hottest of them stands for it.
    expect(replay?.map.tiles.map((tile) => tile.heat).sort()).toEqual([0.9, 1]);
  });

  it("turns a featured treatment into a small cover for the empty board", () => {
    const [cover] = featuredCovers([{ slug: "prateek-kuhad-mumbai", treatment: fakeTreatment(EXAMPLES[0].brief) }]);
    expect(cover).toEqual({
      slug: "prateek-kuhad-mumbai",
      title: "Almost, Every Evening",
      logline: "Two people keep almost meeting.",
      line: "Music video for Prateek Kuhad / Mumbai",
      palette: ["#0A0908"],
      still: "https://img.example/mimi.jpg",
      tone: "Introspective",
    });
  });
});
