import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { llmConfigFromEnv } from "../llm/config";
import { qlooConfigFromEnv } from "../qloo";
import { distanceM } from "../tools/heatmap";
import { briefKey, briefSchema, normalizeBrief } from "./brief";
import { EXAMPLES } from "./examples";
import { FORMATS, audiencePhrase, coverStill, isIdentityTag, subjectPhrase, tagLabel, treatmentWho } from "./options";
import type { QlooEvidence, ShootBase, Treatment } from "./types";

// Featured treatments: the examples pre-built by `npm run featured` (scripts/featured.ts), so judges and
// first-time visitors see a finished treatment at once, whatever the live rate limits are doing. They
// hold Qloo data, so they live under .cache/ (gitignored) and are built afresh by each deploy's prebuild.

export const FEATURED_FILE = path.join(".cache", "featured", "featured.json");

export interface FeaturedItem {
  slug: string;
  treatment: Treatment;
}

export interface FeaturedFile {
  generatedAt: string;
  items: FeaturedItem[];
}

/** What the empty board's cover cards need, without shipping whole treatments to the browser. */
export interface FeaturedCover {
  slug: string;
  title: string;
  logline: string;
  /** "Music video for Prateek Kuhad / Mumbai" */
  line: string;
  palette: string[];
  still?: string;
  /** The first tone tag Qloo gave the treatment, for the poster's "it's giving" sticker. */
  tone?: string;
}

let memo: { file: string; mtimeMs: number; items: FeaturedItem[] } | undefined;

/**
 * Featured treatments are live data, so a server running on mocks doesn't offer them: their covers and pages would
 * promise what a mock run can't deliver. Decided by the keys present at build time, like the pages built from them.
 */
export function featuredOffered(): boolean {
  return qlooConfigFromEnv().mode === "live" && llmConfigFromEnv().mode === "live";
}

function isItem(value: unknown): value is FeaturedItem {
  const item = value as FeaturedItem;
  return typeof item?.slug === "string" && typeof item.treatment?.title === "string" && typeof item.treatment.brief?.city === "string";
}

/**
 * The pre-built treatments, re-read only when the file changes; none when it is missing or unreadable.
 * The reads opt out of Turbopack's tracing (which would otherwise pull in the whole project): the file
 * is added to the server bundle by outputFileTracingIncludes in next.config.ts instead.
 */
export function loadFeatured(file = FEATURED_FILE): FeaturedItem[] {
  try {
    const { mtimeMs } = statSync(/*turbopackIgnore: true*/ file);
    if (memo?.file !== file || memo.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Partial<FeaturedFile>;
      memo = { file, mtimeMs, items: Array.isArray(parsed.items) ? parsed.items.filter(isItem) : [] };
    }
    return memo.items;
  } catch {
    return [];
  }
}

export function featuredCovers(items: FeaturedItem[] = loadFeatured()): FeaturedCover[] {
  return items.map(({ slug, treatment: t }) => ({
    slug,
    title: t.title,
    logline: t.logline,
    line: `${FORMATS[t.brief.format]} ${subjectPhrase(treatmentWho(t).artists, treatmentWho(t).films, t.brief.format)} / ${t.brief.city}`,
    palette: t.palette.map((c) => c.hex),
    still: coverStill(t),
    tone: t.tone.find((tone) => !isIdentityTag(tone.tag.name))?.tag.name,
  }));
}

const LIVE = { qloo: "live", llm: "live" };

/**
 * A featured example's pre-built treatment, for its own page (/t/<slug>). Only while it still answers the example's
 * brief, the same match /api/treatment makes, so the page never offers a board the studio can't reopen at once: after
 * the examples change, a stale build gets the page's stand-in instead.
 */
export function featuredItem(slug: string, items: FeaturedItem[] = loadFeatured()): FeaturedItem | undefined {
  const example = EXAMPLES.find((e) => e.slug === slug && e.featured);
  const item = items.find((i) => i.slug === slug);
  if (!example || !item || item.treatment.mock?.qloo) return undefined;
  const asked = briefKey(normalizeBrief(briefSchema.parse({ ...example.brief, thinking: "deep" })), LIVE);
  return briefKey(item.treatment.brief, LIVE) === asked ? item : undefined;
}

/**
 * One real run, for the homepage's "How it works": what Qloo said at each step and what came of it, with the shoot
 * base exactly as the treatment's own board draws it. A treatment keeps only its hottest tiles (a few hundred at
 * most), so the page carries kilobytes, not the treatment.
 */
export interface FeaturedRun {
  slug: string;
  /** "Prateek Kuhad", or "Past Lives and Aftersun" for a short film. */
  subject: string;
  /** Whose heatmap it is: "Prateek Kuhad's audience". */
  audience: string;
  city: string;
  mock: boolean;
  tones: { name: string; shared: boolean }[];
  leans?: string;
  base: ShootBase;
  receipts: { kind: "film" | "brand" | "place"; name: string; rank: number; of: number; affinity?: number; km?: number }[];
  title: string;
  logline: string;
  /** What the title card's suggestion reads: the tone and taste tags, in Qloo's order. */
  tags: string[];
  qlooCalls: number;
  modelCalls: number;
  writtenBy: string;
}

const round = (n: number, places: number) => Number(n.toFixed(places));

export function featuredRun(items: FeaturedItem[] = loadFeatured()): FeaturedRun | undefined {
  const item = items.find(({ treatment: t }) => (t.base?.map?.tiles.length ?? 0) > 0 && (t.base?.areas.length ?? 0) > 0);
  const base = item?.treatment.base;
  if (!item || !base) return undefined;
  const t = item.treatment;
  const chosen = base.areas.find((a) => a.ref === base.chosen) ?? base.areas[0];

  const receipts: FeaturedRun["receipts"] = [];
  const add = (kind: "film" | "brand" | "place", name: string, qloo: QlooEvidence, km?: number) =>
    receipts.push({ kind, name, rank: qloo.rank, of: qloo.of, affinity: qloo.affinity ?? undefined, km });
  const first = <T extends { qloo: { rank: number } }>(list: T[]) => [...list].sort((a, b) => a.qloo.rank - b.qloo.rank)[0];
  const film = first(t.references);
  if (film) add("film", `${film.entity.name}${film.entity.year ? ` (${film.entity.year})` : ""}`, film.qloo);
  const brand = first(t.wardrobe);
  if (brand) add("brand", brand.entity.name, brand.qloo);
  const place = first(t.locations);
  const spot = place?.entity.place;
  if (place) {
    const km =
      spot?.lat !== undefined && spot?.lon !== undefined ? round(distanceM(chosen, { lat: spot.lat, lon: spot.lon }) / 1000, 1) : undefined;
    add("place", place.entity.name, place.qloo, km);
  }

  return {
    slug: item.slug,
    subject: subjectPhrase(treatmentWho(t).artists, treatmentWho(t).films, t.brief.format).replace(/^(for|after) /, ""),
    audience: audiencePhrase(t.subjects),
    city: t.brief.city,
    mock: t.mock.qloo,
    tones: t.tone
      .filter((tone) => !isIdentityTag(tone.tag.name))
      .slice(0, 5)
      .map((tone) => ({ name: tagLabel(tone.tag.name), shared: tone.source === "overlap" })),
    leans: t.audience.leans[0],
    base,
    receipts,
    title: t.title,
    logline: t.logline,
    tags: [...t.tone.map((tone) => tone.tag.name), ...t.audience.taste_tags.map((tag) => tag.name)],
    qlooCalls: t.qloo.calls,
    modelCalls: t.llm.length,
    writtenBy: t.writtenBy.model,
  };
}
