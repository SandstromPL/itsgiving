import { describe, expect, it } from "vitest";
import { briefSchema, normalizeBrief } from "@/lib/agent/brief";
import { runPipeline } from "@/lib/agent/pipeline";
import type { Treatment } from "@/lib/agent/types";
import { Cooldowns, DailyBudget } from "@/lib/llm";
import { QlooClient, createQlooClient, type FetchLike } from "@/lib/qloo";
import { MemoryCache } from "@/lib/qloo/cache";
import { mockEntityId } from "@/lib/qloo/mock/catalog";
import { createMockFetch } from "@/lib/qloo/mock/server";
import { isIdentityTag } from "@/lib/text";
import { runTool } from "@/lib/tools/registry";
import type { RankedTag } from "@/lib/tools/taste";
import { ERAS, eraOf, noEraLine, suggestEraFrom } from "./eras";
import { TITLE_FONTS } from "./title-fonts";

const SUBGENRE = "urn:tag:subgenre:qloo:";

/** WCAG relative luminance of an opaque #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** `top` at `alpha` over an opaque `under`, as #rrggbb. */
function over(top: [number, number, number], alpha: number, under: string): string {
  return `#${top
    .map((c, i) => Math.round(c * alpha + parseInt(under.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - alpha)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}
// The worst ground a cover's words can get: the scrim's 62% black (globals.css .scrim-under) over a white still, and
// the cover's pills (bg-black/70) over the same.
const SCRIM = over([10, 9, 8], 0.62, "#ffffff");
const PILL = over([0, 0, 0], 0.7, "#ffffff");

const tag = (value: string, name: string, rank: number, affinity = 0.9): RankedTag => ({
  id: `${SUBGENRE}${value}`,
  name,
  rank,
  of: 25,
  affinity,
});

describe("the eras", () => {
  it("each starts in a face the window offers, credits its tradition and carries two stickers", () => {
    const faces = new Set(TITLE_FONTS.map((f) => f.id));
    for (const era of ERAS) {
      expect(faces.has(era.font), era.id).toBe(true);
      expect(era.credit).toMatch(/^Look inspired by /);
      expect(era.stickers).toHaveLength(2);
      expect(era.stickers.every((s) => s.genz && s.unc)).toBe(true);
    }
  });

  it("are suggested only by Qloo's film subgenres, none of which says who people are", () => {
    for (const era of ERAS) {
      expect(era.tags.length).toBeGreaterThan(0);
      for (const id of era.tags) {
        expect(id.startsWith(SUBGENRE), id).toBe(true);
        expect(isIdentityTag(id.slice(SUBGENRE.length).replaceAll("_", " ")), id).toBe(false);
      }
    }
  });

  it("never name a film-stock brand in their own words", () => {
    for (const era of ERAS) {
      const words = [era.name, era.plain, era.credit, era.evokes, ...era.stickers.flatMap((s) => [s.genz, s.unc])].join(" ");
      expect(words, era.id).not.toMatch(/technicolor|kodak|fuji|eastman|agfa/i);
    }
  });

  it("keep every colour pair at AA: the title on a white still's scrim, the credit on its pill, each sticker", () => {
    for (const era of ERAS) {
      expect(contrast(era.colors.title, SCRIM), `${era.id} title`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(era.colors.title, PILL), `${era.id} credit`).toBeGreaterThanOrEqual(4.5);
      for (const [i, s] of era.colors.stickers.entries()) {
        expect(contrast(s.ink, s.ground), `${era.id} sticker ${i + 1}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Paris '60's intertitle sets the title's words on black in its three inks.
    const paris = eraOf("paris60");
    for (const ink of [paris.colors.stickers[0].ink, paris.colors.title, paris.colors.stickers[1].ink]) {
      expect(contrast(ink, "#0a0908"), ink).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("suggestEraFrom", () => {
  it("suggests the era of the best-ranked tradition among the audience's subgenres, with Qloo's receipt", () => {
    // Invented ranks and affinities: no live Qloo result goes into the repo.
    const subgenres = [tag("road", "Road", 1), tag("ensemble", "Ensemble", 3), tag("bollywood", "Bollywood", 5, 0.912)];
    const suggestion = suggestEraFrom(subgenres, false);
    expect(suggestion?.era.id).toBe("bombay75");
    expect(suggestion?.why).toBe("Qloo ranks Bollywood 5 of 25 film subgenres for this audience (affinity 0.912)");
    // The better-ranked tradition wins.
    expect(suggestEraFrom([tag("french_new_wave", "French New Wave", 3), ...subgenres], false)?.era.id).toBe("paris60");
  });

  it("says when the evidence is the mock's, never Qloo's", () => {
    expect(suggestEraFrom([tag("hong_kong_new_wave", "Hong Kong New Wave", 2, 0.8)], true)?.why).toBe(
      "The mock ranks Hong Kong New Wave 2 of 25 film subgenres for this audience (affinity 0.800)",
    );
  });

  it("suggests nothing without a tradition among them, or without the read", () => {
    expect(suggestEraFrom([tag("road", "Road", 2), tag("ensemble", "Ensemble", 7)], false)).toBeUndefined();
    expect(suggestEraFrom(undefined, false)).toBeUndefined();
  });

  it("never lets a tag that says who people are suggest an era, even one listed under an era", () => {
    const named = { ...tag("hollywood_musical", "LGBTQ Hollywood Musical", 2), id: eraOf("hollywood54").tags[0] };
    expect(suggestEraFrom([named], false)).toBeUndefined();
    expect(suggestEraFrom([named, tag("bollywood", "Bollywood", 9)], false)?.era.id).toBe("bombay75");
  });
});

describe("noEraLine", () => {
  const with_ = (subgenres: RankedTag[] | undefined, mock = false) =>
    ({ audience: { taste_tags: [], overlap: [], leans: [], subgenres }, mock: { qloo: mock, llm: false } }) as unknown as Treatment;

  it("explains a missing suggestion only when the subgenres were read", () => {
    expect(noEraLine(with_([tag("road", "Road", 1)]))).toBe(
      "None of these traditions is among the 25 film subgenres Qloo ranks highest for this audience, so none is suggested.",
    );
    expect(noEraLine(with_([tag("bollywood", "Bollywood", 5)]))).toBeUndefined();
    expect(noEraLine(with_(undefined))).toBeUndefined();
  });
});

describe("read_audience's film subgenres (mock Qloo)", () => {
  const prateek = mockEntityId("Prateek Kuhad");

  it("come from their own call, ranked as Qloo returned them, and leave the taste tags as they were", async () => {
    const qloo = createQlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid" });
    const result = await runTool("read_audience", { entity_ids: [prateek] }, { qloo });
    const data = result.data as { taste_tags: { id: string }[]; film_subgenres: RankedTag[] };
    expect(result.status).toBe("ok");
    expect(result.provenance).toHaveLength(3);
    const call = result.provenance.find((p) => p.query["filter.tag.types"] === "urn:tag:subgenre:qloo");
    expect(call?.query).toMatchObject({ "filter.parents.types": "urn:entity:movie", take: "25" });
    expect(data.film_subgenres.length).toBeGreaterThan(0);
    expect(data.film_subgenres.map((t) => t.rank)).toEqual(data.film_subgenres.map((_, i) => i + 1));
    expect(new Set(data.film_subgenres.map((t) => t.of))).toEqual(new Set([data.film_subgenres.length]));
    expect(data.taste_tags.some((t) => t.id.startsWith(SUBGENRE))).toBe(false);
  });

  it("never fail the audience read: a failed call is a warning and an empty list", async () => {
    const mock = createMockFetch();
    const failing: FetchLike = (url, init) =>
      decodeURIComponent(url).includes("urn:tag:subgenre") ? Promise.resolve(new Response("{}", { status: 503 })) : mock(url, init);
    const qloo = new QlooClient({
      mode: "mock",
      baseUrl: "https://mock.qloo.invalid",
      fetch: failing,
      cache: new MemoryCache(),
      maxAttempts: 1,
    });
    const result = await runTool("read_audience", { entity_ids: [prateek] }, { qloo });
    expect(result.status).toBe("ok");
    expect((result.data as { film_subgenres: RankedTag[] }).film_subgenres).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith("Film subgenres unavailable"))).toBe(true);
  });
});

describe("a mock treatment's subgenres", () => {
  const brief = normalizeBrief(briefSchema.parse({ artist: "Prateek Kuhad", city: "Mumbai" }));
  const llm = { mode: "mock" as const, providers: [], budget: new DailyBudget(100), timeoutMs: 1000, cooldowns: new Cooldowns() };
  const build = async (qloo: QlooClient) => {
    const outcome = await runPipeline(brief, { qloo, llm }, () => {}, { id: "eras", signal: new AbortController().signal });
    if (outcome.kind !== "treatment") throw new Error(`expected a treatment, got ${outcome.kind}`);
    return outcome.treatment;
  };

  it("leave out tags that say who people are, keep Qloo's ranks, and suggest an era from what's left", async () => {
    const qloo = createQlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid" });
    const raw = await runTool("read_audience", { entity_ids: [mockEntityId("Prateek Kuhad")] }, { qloo });
    const all = (raw.data as { film_subgenres: RankedTag[] }).film_subgenres;
    // The mock lists one, so the filter is exercised.
    expect(all.some((t) => isIdentityTag(t.name))).toBe(true);

    const t = await build(qloo);
    const kept = t.audience.subgenres ?? [];
    expect(kept.length).toBe(all.length - all.filter((x) => isIdentityTag(x.name)).length);
    expect(kept.some((x) => isIdentityTag(x.name))).toBe(false);
    for (const x of kept) expect(x.rank).toBe(all.find((a) => a.id === x.id)?.rank);
    expect(suggestEraFrom(t.audience.subgenres, t.mock.qloo)?.why).toMatch(/^The mock ranks /);
  });

  it("are left out, and the treatment still complete, when the call fails", async () => {
    const mock = createMockFetch();
    const failing: FetchLike = (url, init) =>
      decodeURIComponent(url).includes("urn:tag:subgenre") ? Promise.resolve(new Response("{}", { status: 503 })) : mock(url, init);
    const t = await build(
      new QlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid", fetch: failing, cache: new MemoryCache(), maxAttempts: 1 }),
    );
    expect(t.audience.subgenres).toBeUndefined();
    expect(t.complete).toBe(true);
    expect(t.audience.taste_tags.length).toBeGreaterThan(0);
  });
});
