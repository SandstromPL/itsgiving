import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { distanceM } from "../tools/heatmap";
import { FORMATS, subjectPhrase } from "./options";
import type { QlooEvidence, Treatment } from "./types";

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
    line: `${FORMATS[t.brief.format]} ${subjectPhrase(
      t.subjects.filter((s) => s.kind === "artist").map((s) => s.name),
      t.subjects.filter((s) => s.kind !== "artist").map((s) => s.name),
    )} / ${t.brief.city}`,
    palette: t.palette.map((c) => c.hex),
    still: t.references.find((r) => r.entity.image && !r.entity.image.startsWith("/mock/"))?.entity.image,
    tone: t.tone[0]?.tag.name,
  }));
}

/**
 * One real run, cut down for the landing's replay: what Qloo said at each step and what came of it. The heatmap is
 * thinned to 2x2 blocks (the replay draws it small), so the page carries a few kilobytes, not the treatment.
 */
export interface FeaturedReplay {
  slug: string;
  /** "Prateek Kuhad", or "Past Lives and Aftersun" for a short film. */
  subject: string;
  city: string;
  mock: boolean;
  tones: { name: string; shared: boolean }[];
  leans?: string;
  map: {
    bounds: { south: number; west: number; north: number; east: number };
    cell: { lat: number; lon: number };
    tiles: { lat: number; lon: number; heat: number }[];
  };
  /** The strongest areas, the chosen base first, and how far locations may sit from it. */
  areas: { name: string; share: number; lat: number; lon: number; chosen: boolean }[];
  radiusKm: number;
  /** False when too few places matched near the base, so locations came from across the city. */
  held: boolean;
  receipts: { kind: "film" | "brand" | "place"; name: string; rank: number; of: number; affinity?: number; km?: number }[];
  title: string;
  /** What the title card's suggestion reads: the tone and taste tags, in Qloo's order. */
  tags: string[];
  qlooCalls: number;
  modelCalls: number;
  writtenBy: string;
}

const round = (n: number, places: number) => Number(n.toFixed(places));

export function featuredReplay(items: FeaturedItem[] = loadFeatured()): FeaturedReplay | undefined {
  const item = items.find(({ treatment: t }) => (t.base?.map?.tiles.length ?? 0) > 0 && (t.base?.areas.length ?? 0) > 0);
  const base = item?.treatment.base;
  const map = base?.map;
  if (!item || !base || !map) return undefined;
  const t = item.treatment;
  const bounds = map.bounds ?? {
    south: Math.min(...map.tiles.map((tile) => tile.lat)) - map.cell.lat,
    north: Math.max(...map.tiles.map((tile) => tile.lat)) + map.cell.lat,
    west: Math.min(...map.tiles.map((tile) => tile.lon)) - map.cell.lon,
    east: Math.max(...map.tiles.map((tile) => tile.lon)) + map.cell.lon,
  };
  const cell = { lat: map.cell.lat * 2, lon: map.cell.lon * 2 };
  const blocks = new Map<string, { lat: number; lon: number; heat: number }>();
  for (const tile of map.tiles) {
    const row = Math.floor((tile.lat - bounds.south) / cell.lat);
    const col = Math.floor((tile.lon - bounds.west) / cell.lon);
    const key = `${row}:${col}`;
    const heat = Math.max(blocks.get(key)?.heat ?? 0, tile.heat);
    blocks.set(key, { lat: bounds.south + (row + 0.5) * cell.lat, lon: bounds.west + (col + 0.5) * cell.lon, heat });
  }
  const chosen = base.areas.find((a) => a.ref === base.chosen) ?? base.areas[0];

  const receipts: FeaturedReplay["receipts"] = [];
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
    subject: subjectPhrase(
      t.subjects.filter((s) => s.kind === "artist").map((s) => s.name),
      t.subjects.filter((s) => s.kind !== "artist").map((s) => s.name),
    ).replace(/^(for|after) /, ""),
    city: t.brief.city,
    mock: t.mock.qloo,
    tones: t.tone.slice(0, 5).map((tone) => ({ name: tone.tag.name, shared: tone.source === "overlap" })),
    leans: t.audience.leans[0],
    map: {
      bounds: { south: round(bounds.south, 5), west: round(bounds.west, 5), north: round(bounds.north, 5), east: round(bounds.east, 5) },
      cell: { lat: round(cell.lat, 6), lon: round(cell.lon, 6) },
      tiles: [...blocks.values()].map((b) => ({ lat: round(b.lat, 5), lon: round(b.lon, 5), heat: round(b.heat, 2) })),
    },
    areas: [chosen, ...base.areas.filter((a) => a !== chosen)].map((a) => ({
      name: a.name,
      share: round(a.share, 3),
      lat: a.lat,
      lon: a.lon,
      chosen: a === chosen,
    })),
    radiusKm: chosen.radius_m / 1000,
    held: base.held,
    receipts,
    title: t.title,
    tags: [...t.tone.map((tone) => tone.tag.name), ...t.audience.taste_tags.map((tag) => tag.name)],
    qlooCalls: t.qloo.calls,
    modelCalls: t.llm.length,
    writtenBy: t.writtenBy.model,
  };
}
