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
import { featuredCovers, loadFeatured, type FeaturedItem } from "./featured";
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

  it("turns a featured treatment into a small cover for the empty board", () => {
    const [cover] = featuredCovers([{ slug: "prateek-kuhad-mumbai", treatment: fakeTreatment(EXAMPLES[0].brief) }]);
    expect(cover).toEqual({
      slug: "prateek-kuhad-mumbai",
      title: "Almost, Every Evening",
      logline: "Two people keep almost meeting.",
      line: "Music video for Prateek Kuhad / Mumbai",
      palette: ["#0A0908"],
      still: "https://img.example/mimi.jpg",
    });
  });
});
