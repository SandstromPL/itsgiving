import type { QlooEntity, QlooTag, TagsResponse } from "./types";
import { excerpt, withoutIdentity } from "../text";
import { WEEKDAYS, kindFromUrn, type EntityKind } from "./urns";

// Readers that tolerate the response-shape conflicts across Qloo's docs, and
// compact views that keep verbose fields (akas, external blobs, long tag lists)
// out of the LLM's context.

type Loose = Record<string, unknown>;

function isRecord(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function entityList(data: unknown): QlooEntity[] {
  const results = isRecord(data) ? data.results : undefined;
  if (Array.isArray(results)) return results as QlooEntity[];
  if (isRecord(results) && Array.isArray(results.entities)) return results.entities as QlooEntity[];
  return [];
}

export function tagList(data: TagsResponse | unknown): QlooTag[] {
  const results = isRecord(data) ? data.results : undefined;
  if (Array.isArray(results)) return results as QlooTag[];
  if (isRecord(results) && Array.isArray(results.tags)) return results.tags as QlooTag[];
  return [];
}

export function tagId(tag: QlooTag): string {
  return tag.tag_id ?? tag.id ?? "";
}

/**
 * One heatmap tile: a geohash cell (150 m to 5 km; Qloo sizes them by density) with Qloo's scores for the
 * signal there. Both scores are percentiles across the area's tiles and track each other closely
 * (correlation 0.9+ on live New York and Mumbai, 2026-10-25), yet differ by audience.
 */
export interface HeatCell {
  lat: number;
  lon: number;
  /** Geohash length, the tile's size: 7 is about 150 m, 6 about 1.2 x 0.6 km, 5 about 5 km. */
  precision: number;
  /** How strongly the audience over-indexes in the tile. */
  affinity: number;
  /** How much of the audience's signal falls in the tile. */
  popularity: number;
}

export function heatmapCells(data: unknown): HeatCell[] {
  const results = isRecord(data) ? data.results : undefined;
  const cells = isRecord(results) && Array.isArray(results.heatmap) ? results.heatmap : [];
  return cells.flatMap((cell): HeatCell[] => {
    if (!isRecord(cell) || !isRecord(cell.location)) return [];
    const lat = num(cell.location.latitude);
    const lon = num(cell.location.longitude);
    if (lat === undefined || lon === undefined) return [];
    const query: Loose = isRecord(cell.query) ? cell.query : {};
    return [
      {
        lat,
        lon,
        precision: str(cell.location.geohash)?.length ?? 0,
        affinity: num(query.affinity) ?? 0,
        popularity: num(query.popularity) ?? 0,
      },
    ];
  });
}

const LOCALITY_GENRE = "urn:tag:genre:locality:";

/** A locality's kind from its genre tag: "city", "state", "county", "suburb", "neighbourhood"... */
export function localityKind(entity: QlooEntity): string | undefined {
  return (entity.tags ?? [])
    .map(tagId)
    .find((id) => id.startsWith(LOCALITY_GENRE))
    ?.slice(LOCALITY_GENRE.length);
}

export interface Contribution {
  entity_id: string;
  score: number;
}

/**
 * The exact shape of `query.explainability` isn't pinned down in the docs, so
 * collect every {entity_id, score}-like pair found anywhere inside it.
 */
export function extractContributions(explainability: unknown, limit = 5): Contribution[] {
  const found = new Map<string, number>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, depth + 1));
      return;
    }
    const record = node as Loose;
    const id = str(record.entity_id) ?? str(record.id);
    const score = num(record.score) ?? num(record.value) ?? num(record.weight) ?? num(record.contribution);
    if (id && score !== undefined) {
      found.set(id, Math.max(score, found.get(id) ?? -Infinity));
    }
    Object.values(record).forEach((child) => visit(child, depth + 1));
  };
  visit(explainability, 0);
  return [...found.entries()]
    .map(([entity_id, score]) => ({ entity_id, score: Math.round(score * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type Weekday = (typeof WEEKDAYS)[number];

export interface CompactPlace {
  /** Qloo's primary genre for the place, e.g. "Lounge bar". */
  kind?: string;
  /** Qloo's own one-line read of the atmosphere (properties.ambience_description). */
  ambience?: string;
  /** What the space itself is like, in Qloo's words (properties.physical_setting_description). */
  setting?: string;
  address?: string;
  neighborhood?: string;
  city?: string;
  country_code?: string;
  price_level?: number;
  business_rating?: number;
  lat?: number;
  lon?: number;
  /** Local opening hours per day, "12:00–15:30" (two sittings joined by ", ") or "closed". */
  hours?: Partial<Record<Weekday, string>>;
  /** The venue's own number and site, for asking about filming there: business listings, never a person's. */
  phone?: string;
  website?: string;
  /** The times of day Qloo says the place suits ("Evening") and its views ("Street view"). */
  fits?: string[];
  views?: string[];
}

export interface CompactBrand {
  /** Qloo's sentence on the brand's design language (properties.style_description). */
  style?: string;
  /** Its aesthetic in Qloo's words: "Earthy Tones", "Hand-Finished Details". */
  traits?: string[];
  /** What its pieces sell for, in US dollars. */
  price?: { min?: number; max?: number };
}

export interface CompactArtist {
  /** A few of the artist's notable songs as Qloo lists them: the only songs a treatment may name. */
  songs?: string[];
  genres?: string[];
  /** What the lyrics are about, without themes that say who people are (isIdentityTag). */
  themes?: string[];
}

export interface CompactEntity {
  id: string;
  name: string;
  kind?: EntityKind;
  type?: string;
  year?: number;
  disambiguation?: string;
  description?: string;
  image?: string;
  popularity?: number;
  affinity?: number | null;
  tags: string[];
  because?: Contribution[];
  place?: CompactPlace;
  brand?: CompactBrand;
  artist?: CompactArtist;
  external?: { imdb?: string; spotify?: string; letterboxd?: string };
}

/** Up to `max` non-empty strings from a list Qloo may send as strings, nulls or nothing. */
function strings(value: unknown, max: number): string[] | undefined {
  const list = Array.isArray(value) ? value.map(str).filter((v): v is string => v !== undefined) : [];
  return list.length > 0 ? list.slice(0, max) : undefined;
}

/** "T12:00:00" -> "12:00". */
const clock = (value: unknown) =>
  str(value)
    ?.match(/(\d{2}):(\d{2})/)
    ?.slice(1, 3)
    .join(":");

/**
 * Qloo's hours ({monday: [{opens: "T12:00:00", closes: "T15:30:00", closed: false}], ...}) as one short string a
 * day. A day Qloo doesn't list is left out rather than called closed.
 */
function openingHours(value: unknown): CompactPlace["hours"] {
  if (!isRecord(value)) return undefined;
  const hours: CompactPlace["hours"] = {};
  for (const day of WEEKDAYS) {
    const slots = Array.isArray(value[day]) ? value[day].filter(isRecord) : [];
    if (slots.length === 0) continue;
    const open = slots.filter((slot) => slot.closed !== true && clock(slot.opens) && clock(slot.closes));
    if (open.length > 0) hours[day] = open.map((slot) => `${clock(slot.opens)}–${clock(slot.closes)}`).join(", ");
    else if (slots.every((slot) => slot.closed === true)) hours[day] = "closed";
  }
  return Object.keys(hours).length > 0 ? hours : undefined;
}

/** A web address worth linking to: http or https only, so nothing else ever lands in an href. */
function webAddress(value: unknown): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** A phone number as dialled: "+", digits, spaces and dashes, with at least 7 digits. */
function phoneNumber(value: unknown): string | undefined {
  const text = str(value)?.trim();
  return text && /^\+?[\d\s()-]+$/.test(text) && (text.match(/\d/g)?.length ?? 0) >= 7 ? text : undefined;
}

/** The names of an entity's tags of one type ("urn:tag:view:qloo"), which pickTags would mix with the rest. */
function tagNames(tags: QlooTag[], type: string, max: number): string[] | undefined {
  const names = tags.filter((tag) => tag.type === type && tag.name).map((tag) => tag.name);
  return names.length > 0 ? names.slice(0, max) : undefined;
}

/** An object with its empty fields dropped, or undefined when nothing is left. */
function filled<T extends object>(value: T): T | undefined {
  const kept = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
  return Object.keys(kept).length > 0 ? (kept as T) : undefined;
}

function firstExternalId(external: unknown, key: string): string | undefined {
  if (!isRecord(external)) return undefined;
  const value = external[key];
  if (Array.isArray(value)) {
    const first = value[0];
    return isRecord(first) ? str(first.id) : str(first);
  }
  return isRecord(value) ? str(value.id) : str(value);
}

/** Names as typed into Qloo's sources, spacing fixed: "Poco Loco Tapas & Bar ,Khar" -> "Poco Loco Tapas & Bar, Khar". */
function tidyName(name: string): string {
  return name
    .replace(/\s+,/g, ",")
    .replace(/,(?=[^\s\d])/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Descriptions are kept short, ending on a sentence or a word (live, "consistently upbe…" read as broken). */
function truncate(text: string | undefined, max: number): string | undefined {
  return text ? excerpt(text, max) : undefined;
}

function round(value: number | undefined | null): number | undefined | null {
  if (value === null) return null;
  return value === undefined ? undefined : Math.round(value * 1000) / 1000;
}

/**
 * Tag families worth showing per kind, best first. Live entities carry dozens
 * of tags (film keywords like "Smoothie", brand tags like "Website"); these
 * families describe look and feel, e.g. a film's style:qloo tags read like
 * cinematography notes ("Stark close ups", "Moody").
 */
const TAG_PRIORITY: Partial<Record<EntityKind, string[]>> = {
  movie: ["urn:tag:style:qloo", "urn:tag:genre:media", "urn:tag:plot:qloo"],
  tv_show: ["urn:tag:style:qloo", "urn:tag:genre:media", "urn:tag:plot:qloo"],
  brand: ["urn:tag:aesthetic_property:qloo", "urn:tag:personal_style:qloo", "urn:tag:emotional_tone:qloo"],
  place: ["urn:tag:genre:place", "urn:tag:ambience:qloo", "urn:tag:decor:qloo", "urn:tag:setting:qloo"],
  artist: ["urn:tag:genre:music", "urn:tag:style:qloo"],
};

/** Labels too generic to be evidence of anything. */
const GENERIC_TAGS = new Set(["place", "website", "other"]);

/** Up to `max` tag names: the kind's priority families first (a few each), then the rest in Qloo's order. */
export function pickTags(tags: QlooTag[], kind: EntityKind | undefined, max: number): string[] {
  const useful = tags.filter((tag) => tag.name && !GENERIC_TAGS.has(tag.name.toLowerCase()));
  const priority = (kind && TAG_PRIORITY[kind]) || [];
  const perFamily = Math.max(2, Math.ceil(max / Math.max(priority.length, 1)));
  const first = priority.flatMap((family) => useful.filter((tag) => tag.type === family).slice(0, perFamily));
  const names: string[] = [];
  for (const tag of [...first, ...useful]) {
    if (!names.some((n) => n.toLowerCase() === tag.name.toLowerCase())) names.push(tag.name);
    if (names.length === max) break;
  }
  return names;
}

export function compactEntity(entity: QlooEntity, options: { maxTags?: number; maxDescription?: number } = {}): CompactEntity {
  const props: Loose = isRecord(entity.properties) ? entity.properties : {};
  const geocode: Loose = isRecord(props.geocode) ? props.geocode : {};
  const location: Loose = isRecord(props.location) ? props.location : {};
  const type = entity.subtype ?? entity.types?.[0] ?? entity.type;
  const kind = kindFromUrn(type);

  const compact: CompactEntity = {
    id: entity.entity_id,
    name: tidyName(entity.name),
    kind,
    type,
    year: num(props.release_year) ?? num(props.publication_year),
    disambiguation: str(entity.disambiguation),
    description: truncate(str(props.description) ?? str(props.short_description), options.maxDescription ?? 240),
    image: isRecord(props.image) ? str(props.image.url) : undefined,
    popularity: round(num(entity.popularity)) ?? undefined,
    affinity: entity.query && "affinity" in entity.query ? round(entity.query.affinity ?? null) : undefined,
    tags: pickTags(entity.tags ?? [], kind, options.maxTags ?? 8),
  };

  const because = extractContributions(entity.query?.explainability);
  if (because.length > 0) compact.because = because;

  // Kept per kind: what describes the work a director would borrow from. Never a person's birth date, gender or
  // citizenship, a brand's target income or audience identity, or a venue's customer demographics: those describe
  // people, and SAFE_USE keeps them out.
  if (kind === "place") {
    const primary = props.primary_genre;
    compact.place = {
      kind: isRecord(primary) ? str(primary.name) : str(primary),
      ambience: truncate(str(props.ambience_description), 220),
      setting: truncate(str(props.physical_setting_description), 180),
      address: str(props.address),
      neighborhood: str(props.neighborhood) ?? str(geocode.neighborhood),
      city: str(geocode.city) ?? str(props.city),
      country_code: str(geocode.country_code) ?? str(props.country_code),
      price_level: num(props.price_level),
      business_rating: num(props.business_rating),
      lat: num(entity.location?.lat) ?? num(props.lat) ?? num(props.latitude) ?? num(location.lat) ?? num(geocode.latitude),
      lon: num(entity.location?.lon) ?? num(props.lon) ?? num(props.longitude) ?? num(location.lon) ?? num(geocode.longitude),
      hours: openingHours(props.hours),
      phone: phoneNumber(props.phone),
      website: webAddress(props.website),
      fits: tagNames(entity.tags ?? [], "urn:tag:time_of_day_fit:qloo", 3),
      views: tagNames(entity.tags ?? [], "urn:tag:view:qloo", 2),
    };
  }
  if (kind === "brand") {
    const [min, max] = [num(props.price_range_usd_min), num(props.price_range_usd_max)];
    compact.brand = filled({
      style: truncate(str(props.style_description), 160),
      traits: strings(props.aesthetic_properties, 5),
      price: min !== undefined || max !== undefined ? filled({ min, max }) : undefined,
    });
  }
  if (kind === "artist") {
    compact.artist = filled({
      songs: strings(props.notable_songs, 4),
      genres: strings(props.primary_genres, 3),
      themes: strings(
        withoutIdentity(strings(props.lyrical_themes, 8) ?? [], (theme) => theme),
        3,
      ),
    });
  }

  // Live responses have carried external IDs in two places: a top-level `external` of [{id}] lists (2026-10-24) and
  // `properties.external` of {id, user_rating, ...} objects (from 2026-10-25). Read both.
  const externalId = (key: string) => firstExternalId(entity.external, key) ?? firstExternalId(props.external, key);
  const external = { imdb: externalId("imdb"), spotify: externalId("spotify"), letterboxd: externalId("letterboxd") };
  if (external.imdb || external.spotify || external.letterboxd) compact.external = external;

  return compact;
}

export interface CompactTag {
  id: string;
  name: string;
  type?: string;
  affinity?: number;
  score?: number;
}

export function compactTag(tag: QlooTag): CompactTag {
  return {
    id: tagId(tag),
    name: tag.name,
    type: tag.subtype ?? tag.type ?? tag.types?.[0],
    affinity: round(tag.query?.affinity) ?? undefined,
    score: round(tag.query?.score) ?? undefined,
  };
}
