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
import { featuredCovers, featuredItem, featuredRun, loadFeatured, type FeaturedItem } from "./featured";
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

  it("gives every featured example a short, unique, URL-safe slug for its page", () => {
    const slugs = EXAMPLES.filter((e) => e.featured).map((e) => e.slug);
    expect(slugs.length).toBeGreaterThan(0);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("finds a featured page's treatment only while it still answers the example's brief", () => {
    const [prateek] = EXAMPLES;
    const nonFeatured = EXAMPLES.find((e) => !e.featured)!;
    const item = { slug: prateek.slug, treatment: fakeTreatment(prateek.brief) };
    expect(featuredItem(prateek.slug, [item])).toBe(item);
    expect(featuredItem("nope", [item])).toBeUndefined();
    // Pre-built under a slug that isn't featured: no page for it.
    expect(featuredItem(nonFeatured.slug, [{ slug: nonFeatured.slug, treatment: fakeTreatment(nonFeatured.brief) }])).toBeUndefined();
    // Built from a brief the example no longer has (the examples changed since the build): the page's stand-in instead.
    expect(
      featuredItem(prateek.slug, [{ slug: prateek.slug, treatment: fakeTreatment({ ...prateek.brief, city: "Delhi" }) }]),
    ).toBeUndefined();
    // Never a mock run, whatever its brief.
    const mock = { ...fakeTreatment(prateek.brief), mock: { qloo: true, llm: false } } as Treatment;
    expect(featuredItem(prateek.slug, [{ slug: prateek.slug, treatment: mock }])).toBeUndefined();
  });

  it("explains a featured run with a heatmap on the homepage, its base as the board draws it", () => {
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

    expect(featuredRun([plain])).toBeUndefined();
    const story = featuredRun([plain, { slug: "prateek-kuhad-mumbai", treatment: run }]);
    expect(story).toMatchObject({
      slug: "prateek-kuhad-mumbai",
      subject: "Prateek Kuhad",
      audience: "Prateek Kuhad's audience",
      city: "Mumbai",
      leans: "over-indexes 30 to 34, skews female",
      title: "Almost, Every Evening",
      logline: "Two people keep almost meeting.",
      qlooCalls: 21,
      modelCalls: 2,
      writtenBy: "deepseek-flash",
      tags: ["Introspective", "Indie folk"],
    });
    // The same shoot base the board draws, not a cut-down copy.
    expect(story?.base).toBe(run.base);
    // The best-ranked film, brand and place, the place with its distance from the chosen base (Bandra West).
    expect(story?.receipts).toEqual([
      { kind: "film", name: "Darlings (2022)", rank: 2, of: 10, affinity: 0.945 },
      { kind: "brand", name: "Suta", rank: 2, of: 8, affinity: 0.988 },
      { kind: "place", name: "The Bad Cafe", rank: 2, of: 8, affinity: 0.733, km: 0.6 },
    ]);
  });

  it("turns a featured treatment into a small cover for its poster, with a film's still but never its poster", () => {
    const t = fakeTreatment(EXAMPLES[0].brief);
    // Qloo's image of a film is its poster, whose own lettering would fight the title: no still, no picture.
    expect(featuredCovers([{ slug: "prateek-kuhad-mumbai", treatment: t }])[0].still).toBeUndefined();
    t.references[0] = { ...t.references[0], still: "https://image.tmdb.org/t/p/w1280/mimi.jpg" };
    const [cover] = featuredCovers([{ slug: "prateek-kuhad-mumbai", treatment: t }]);
    expect(cover).toEqual({
      slug: "prateek-kuhad-mumbai",
      title: "Almost, Every Evening",
      logline: "Two people keep almost meeting.",
      line: "Music video for Prateek Kuhad / Mumbai",
      palette: ["#0A0908"],
      still: "https://image.tmdb.org/t/p/w1280/mimi.jpg",
      tone: "Introspective",
    });
  });
});
