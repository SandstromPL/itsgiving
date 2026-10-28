import type { FetchLike } from "../client";
import { TAG_TYPES } from "../urns";
import {
  CITIES,
  ENTITIES,
  ENTITY_TAGS,
  LOCALITIES,
  SUBGENRES,
  TAGS,
  type MockCity,
  type MockEntity,
  type MockLocality,
  type MockTag,
} from "./catalog";

// A small fake of the Qloo API for building without a key. It mirrors the
// documented request/response shapes and the known gotchas (403 for
// unsupported types, 400 when no valid signal or filter is given, 404 for an
// empty /search, GET-only), and scores affinity from hand-assigned "vibes".
// Responses carry `_mock: true` and an `x-qloo-mock` header.

const SUPPORTED_TYPES = new Set([
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:destination",
  "urn:entity:locality",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:videogame",
  "urn:tag",
  "urn:demographics",
  "urn:heatmap",
]);

type Vector = Map<string, number>;

const entityById = new Map(ENTITIES.map((e) => [e.id, e]));
// Tags only entities carry (ENTITY_TAGS) are served on entities and honoured as filters, never offered by the tag search.
const tagById = new Map([...TAGS, ...ENTITY_TAGS].map((t) => [t.id, t]));
const localityById = new Map(LOCALITIES.map((l) => [l.id, l]));

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Deterministic pseudo-random number in [0, 1) seeded by text. */
function unit(seed: string): number {
  return (hash(seed) % 10_000) / 10_000;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function toVector(vibes: string[], weight = 1, into: Vector = new Map()): Vector {
  for (const vibe of vibes) into.set(vibe, (into.get(vibe) ?? 0) + weight);
  return into;
}

function cosine(a: Vector, b: Vector): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [key, value] of a) {
    na += value * value;
    dot += value * (b.get(key) ?? 0);
  }
  for (const value of b.values()) nb += value * value;
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function list(params: URLSearchParams, key: string): string[] {
  const value = params.get(key);
  return value
    ? value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
}

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const value = params.get(key);
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-qloo-request-id": `mock-${hash(JSON.stringify(body)).toString(16)}`,
      "x-qloo-mock": "1",
    },
  });
}

function fail(status: number, reason: string): Response {
  return respond({ error: { reason, message: reason, code: status } }, status);
}

function findCity(query: string): { city: MockCity; neighborhood?: string } | undefined {
  const q = normalize(query);
  for (const city of CITIES) {
    if (city.aliases.some((alias) => normalize(alias) === q)) return { city };
  }
  for (const entity of ENTITIES) {
    const neighborhood = entity.properties.neighborhood;
    if (typeof neighborhood === "string" && normalize(neighborhood) === q) {
      const city = CITIES.find((c) => c.name === (entity.properties.geocode as { city?: string })?.city);
      if (city) return { city, neighborhood };
    }
  }
  return undefined;
}

interface LatLon {
  lat: number;
  lon: number;
}

function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** "POINT(lon lat)" (WKT, longitude first) or "lat,lon", the two point forms Qloo accepts. */
function parsePoint(text: string): LatLon | undefined {
  const wkt = /^POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/i.exec(text.trim());
  if (wkt) return { lon: Number(wkt[1]), lat: Number(wkt[2]) };
  const pair = /^(-?[\d.]+)\s*,\s*(-?[\d.]+)$/.exec(text.trim());
  return pair ? { lat: Number(pair[1]), lon: Number(pair[2]) } : undefined;
}

function placeCoords(entity: MockEntity): LatLon | undefined {
  const { lat, lon } = entity.properties;
  return typeof lat === "number" && typeof lon === "number" ? { lat, lon } : undefined;
}

/** Where a request points: within `radiusM` of `center`, or a mock city (and neighbourhood). */
interface Area {
  name: string;
  center: LatLon;
  radiusM?: number;
  city?: MockCity;
  neighborhood?: string;
}

/**
 * filter.location (a point, "lat,lon" or a locality ID) or filter.location.query (a name). Undefined when
 * the location can't be found; null when the request gives none.
 */
function locate(params: URLSearchParams): Area | undefined | null {
  const raw = params.get("filter.location");
  if (raw !== null) {
    const point = parsePoint(raw);
    if (point) return { name: raw, center: point, radiusM: numberParam(params, "filter.location.radius") ?? 15_000 };
    const locality = localityById.get(raw);
    if (!locality) return undefined;
    const center = { lat: locality.lat, lon: locality.lon };
    if (locality.kind !== "city" && locality.kind !== "state") return { name: locality.name, center, radiusM: 1_500 };
    return { name: locality.name, center, city: CITIES.find((c) => c.name === locality.city) };
  }
  const query = params.get("filter.location.query");
  if (query === null) return null;
  const located = findCity(query);
  return located
    ? { name: located.city.name, center: located.city.center, city: located.city, neighborhood: located.neighborhood }
    : undefined;
}

function inArea(entity: MockEntity, area: Area): boolean {
  if (area.radiusM !== undefined) {
    const at = placeCoords(entity);
    return at !== undefined && distanceM(area.center, at) <= area.radiusM;
  }
  const city = (entity.properties.geocode as { city?: string } | undefined)?.city;
  return city === area.city?.name && (!area.neighborhood || entity.properties.neighborhood === area.neighborhood);
}

/** A 6-character geohash tile, about 1.2 x 0.6 km. */
const TILE = { lat: 180 / 2 ** 15, lon: 360 / 2 ** 15 };

/**
 * Geohash-6-sized tiles over the area's places. A tile's affinity is high near places whose vibes match the
 * signal, and its popularity (activity) is high near any place, so the strongest area is somewhere a fitting
 * shoot could happen. An area with no places (the state, centred upstate) comes back cold.
 */
function mockHeatmap(area: Area, profile: Profile) {
  const spots = ENTITIES.filter((e) => e.subtype === "urn:entity:place" && inArea(e, area)).flatMap((e) => {
    const at = placeCoords(e);
    return at ? [{ ...at, match: profile.vector.size > 0 ? cosine(profile.vector, toVector(e.vibes)) : 0.5 }] : [];
  });
  const lats = spots.length > 0 ? spots.map((s) => s.lat) : [area.center.lat];
  const lons = spots.length > 0 ? spots.map((s) => s.lon) : [area.center.lon];
  const margin = 0.03;
  const cells: { location: { latitude: number; longitude: number; geohash: string }; query: Record<string, number> }[] = [];
  for (let lat = Math.min(...lats) - margin; lat <= Math.max(...lats) + margin; lat += TILE.lat) {
    for (let lon = Math.min(...lons) - margin; lon <= Math.max(...lons) + margin; lon += TILE.lon) {
      const weights = spots.map((s) => ({ match: s.match, w: Math.exp(-((distanceM({ lat, lon }, s) / 1_200) ** 2)) }));
      const affinity = 0.2 + 0.8 * Math.max(0, ...weights.map(({ match, w }) => match * w));
      const popularity = Math.min(1, 0.05 + 0.6 * weights.reduce((sum, { w }) => sum + w, 0));
      const geohash = `mk${cells.length.toString(36).padStart(4, "0")}`;
      cells.push({
        location: { latitude: Math.round(lat * 1e5) / 1e5, longitude: Math.round(lon * 1e5) / 1e5, geohash },
        query: { affinity: round(affinity), affinity_rank: round(affinity), popularity: round(popularity) },
      });
    }
  }
  return cells;
}

function serializeLocality(locality: MockLocality) {
  return {
    name: locality.name,
    entity_id: locality.id,
    type: "urn:entity",
    subtype: "urn:entity:locality",
    popularity: locality.popularity,
    disambiguation: locality.disambiguation,
    location: { lat: locality.lat, lon: locality.lon },
    tags: [{ id: `urn:tag:genre:locality:${locality.kind}`, name: locality.kind, type: "urn:tag:genre:locality" }],
  };
}

/** Localities by name (exact names first, in catalog order) or, with no query, nearest first around filter.location. */
function searchLocalities(params: URLSearchParams): Response {
  const query = normalize(params.get("query") ?? "");
  let found: MockLocality[];
  if (query) {
    const alias = findCity(query)?.city.name;
    found = LOCALITIES.map((l) => ({
      l,
      score: normalize(l.name) === query ? 3 : l.kind === "city" && l.city === alias ? 2 : normalize(l.name).startsWith(query) ? 1 : 0,
    }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.l);
  } else {
    const point = parsePoint(params.get("filter.location") ?? "");
    if (!point) return fail(400, "query is required");
    // /search takes its radius in miles.
    const reach = (numberParam(params, "filter.radius") ?? 10) * 1_609.34;
    found = LOCALITIES.map((l) => ({ l, d: distanceM(point, l) }))
      .filter((m) => m.d <= reach)
      .sort((a, b) => a.d - b.d)
      .map((m) => m.l);
  }
  if (found.length === 0) return fail(404, "No results");
  return respond({ success: true, results: page(found.map(serializeLocality), params, 20, 100), _mock: true });
}

function serializeEntity(entity: MockEntity) {
  return {
    name: entity.name,
    entity_id: entity.id,
    type: "urn:entity",
    subtype: entity.subtype,
    properties: entity.properties,
    popularity: entity.popularity,
    disambiguation: entity.disambiguation,
    tags: entity.tags
      .map((id) => tagById.get(id))
      .filter((t): t is MockTag => Boolean(t))
      .map((t) => ({ id: t.id, name: t.name, type: t.type })),
    external: {
      ...(entity.external?.imdb ? { imdb: [{ id: entity.external.imdb }] } : {}),
      ...(entity.external?.spotify ? { spotify: [{ id: entity.external.spotify }] } : {}),
    },
  };
}

function page<T>(items: T[], params: URLSearchParams, defaultTake: number, maxTake: number): T[] {
  const take = Math.min(Math.max(numberParam(params, "take") ?? defaultTake, 1), maxTake);
  const pageNumber = Math.max(numberParam(params, "page") ?? 1, 1);
  const offset = numberParam(params, "offset") ?? (pageNumber - 1) * take;
  return items.slice(offset, offset + take);
}

interface Profile {
  vector: Vector;
  entityIds: string[];
  hasSignal: boolean;
}

function buildProfile(params: URLSearchParams, prefix = ""): Profile {
  const vector: Vector = new Map();
  const entityIds = list(params, `${prefix}signal.interests.entities`).filter((id) => entityById.has(id));
  for (const id of entityIds) toVector(entityById.get(id)!.vibes, 1, vector);
  const tagIds = list(params, `${prefix}signal.interests.tags`).filter((id) => tagById.has(id));
  for (const id of tagIds) toVector(tagById.get(id)!.vibes, 0.8, vector);
  const age = list(params, `${prefix}signal.demographics.age`);
  if (age.some((bucket) => bucket === "24_and_younger" || bucket === "25_to_29")) {
    toVector(["playful", "neon", "rebellious"], 0.3, vector);
  }
  if (age.some((bucket) => bucket === "45_to_54" || bucket === "55_and_older")) {
    toVector(["nostalgic", "warm", "retro"], 0.3, vector);
  }
  const hasSignal =
    entityIds.length + tagIds.length + age.length > 0 ||
    params.has(`${prefix}signal.demographics.gender`) ||
    params.has(`${prefix}signal.location.query`) ||
    params.has(`${prefix}signal.location`);
  return { vector, entityIds, hasSignal };
}

function rankEntities(candidates: MockEntity[], profile: Profile, explain: boolean) {
  const signalVectors = profile.entityIds.map((id) => ({ id, vector: toVector(entityById.get(id)!.vibes) }));
  if (profile.vector.size === 0) {
    return [...candidates]
      .sort((x, y) => y.popularity - x.popularity)
      .map((entity) => ({ ...serializeEntity(entity), query: { affinity: null } }));
  }
  const scored = candidates.map((entity) => {
    const vector = toVector(entity.vibes);
    return { entity, vector, raw: 0.85 * cosine(profile.vector, vector) + 0.15 * entity.popularity };
  });
  const max = Math.max(...scored.map((item) => item.raw), 1e-9);
  return scored
    .sort((x, y) => y.raw - x.raw)
    .map(({ entity, vector, raw }) => {
      const query: Record<string, unknown> = { affinity: round((raw / max) * 0.99) };
      if (explain && signalVectors.length > 0) {
        const parts = signalVectors.map((signal) => ({ entity_id: signal.id, score: cosine(signal.vector, vector) }));
        const total = parts.reduce((sum, part) => sum + part.score, 0) || 1;
        // Mock guess at the shape; the real one is unverified (see normalize.ts).
        query.explainability = {
          "signal.interests.entities": parts
            .map((part) => ({ entity_id: part.entity_id, score: round(part.score / total) }))
            .sort((x, y) => y.score - x.score),
        };
      }
      return { ...serializeEntity(entity), query };
    });
}

function insights(params: URLSearchParams): Response {
  const type = params.get("filter.type");
  if (!type) return fail(400, "filter.type is required");
  if (!SUPPORTED_TYPES.has(type)) return fail(403, `You do not have permission to access ${type}`);

  const profile = buildProfile(params);
  const explain = params.get("feature.explainability") === "true";

  if (type === "urn:demographics") {
    const signals = [
      ...list(params, "signal.interests.entities").filter((id) => entityById.has(id)),
      ...list(params, "signal.interests.tags").filter((id) => tagById.has(id)),
    ];
    if (signals.length === 0) return fail(400, "at least one valid signal or filter is required");
    const demographics = signals.map((id) => {
      const ages = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];
      const raw = ages.map((bucket) => unit(`${id}:${bucket}`) - 0.5);
      const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length;
      const male = round(unit(`${id}:gender`) * 0.6 - 0.3);
      return {
        entity_id: id,
        query: {
          age: Object.fromEntries(ages.map((bucket, i) => [bucket, round(raw[i] - mean)])),
          gender: { male, female: round(-male) },
        },
      };
    });
    return respond({ success: true, results: { demographics }, duration: 9, _mock: true });
  }

  if (type === "urn:tag") {
    const tagTypes = list(params, "filter.tag.types");
    const parentTypes = list(params, "filter.parents.types");
    const hasFilter = tagTypes.length > 0 || parentTypes.length > 0;
    if (!profile.hasSignal && !hasFilter) return fail(400, "at least one valid signal or filter is required");
    // Film subgenres answer only a call that asks for them (read_audience's era leg).
    const pool = tagTypes.includes(TAG_TYPES.subgenre) ? [...TAGS, ...SUBGENRES] : TAGS;
    const candidates = pool.filter(
      (t) =>
        (tagTypes.length === 0 || tagTypes.includes(t.type)) &&
        (parentTypes.length === 0 || t.parents.some((parent) => parentTypes.includes(parent))),
    );
    const scored = candidates
      .map((t) => ({
        t,
        score: profile.vector.size ? 0.9 * cosine(profile.vector, toVector(t.vibes)) + 0.1 * t.popularity : t.popularity,
      }))
      .sort((x, y) => y.score - x.score);
    const max = Math.max(...scored.map((item) => item.score), 1e-9);
    const tags = page(scored, params, 20, 50).map(({ t, score }) => ({
      tag_id: t.id,
      name: t.name,
      types: [t.type],
      subtype: t.type,
      query: { affinity: round((score / max) * 0.99) },
    }));
    return respond({ success: true, results: { tags }, duration: 11, _mock: true });
  }

  if (type === "urn:heatmap") {
    const area = locate(params);
    if (!area) return fail(400, "A location is required for heatmaps (filter.location or filter.location.query)");
    if (!profile.hasSignal) return fail(400, "at least one valid signal or filter is required");
    return respond({
      success: true,
      results: { heatmap: mockHeatmap(area, profile) },
      query: { localities: { filter: [{ name: area.name }] } },
      _mock: true,
    });
  }

  let candidates = ENTITIES.filter((entity) => entity.subtype === type && !profile.entityIds.includes(entity.id));
  let hasFilter = false;

  const filterTags = list(params, "filter.tags").filter((id) => tagById.has(id));
  if (filterTags.length > 0) {
    hasFilter = true;
    const all = params.get("operator.filter.tags") === "intersection";
    candidates = candidates.filter((entity) =>
      all ? filterTags.every((id) => entity.tags.includes(id)) : filterTags.some((id) => entity.tags.includes(id)),
    );
  }
  const excludeTags = list(params, "filter.exclude.tags");
  if (excludeTags.length > 0) candidates = candidates.filter((entity) => !excludeTags.some((id) => entity.tags.includes(id)));
  const excludeIds = list(params, "filter.exclude.entities");
  if (excludeIds.length > 0) candidates = candidates.filter((entity) => !excludeIds.includes(entity.id));
  const only = list(params, "filter.results.entities");
  if (only.length > 0) {
    hasFilter = true;
    candidates = ENTITIES.filter((entity) => entity.subtype === type && only.includes(entity.id));
  }

  const ranges: [string, (entity: MockEntity) => number | undefined][] = [
    ["filter.popularity", (entity) => entity.popularity],
    ["filter.release_year", (entity) => entity.properties.release_year as number | undefined],
    ["filter.price_level", (entity) => entity.properties.price_level as number | undefined],
  ];
  for (const [key, read] of ranges) {
    const min = numberParam(params, `${key}.min`);
    const max = numberParam(params, `${key}.max`);
    if (min === undefined && max === undefined) continue;
    hasFilter = true;
    candidates = candidates.filter((entity) => {
      const value = read(entity);
      return value !== undefined && (min === undefined || value >= min) && (max === undefined || value <= max);
    });
  }

  if (params.get("filter.exists") === "properties.image") {
    candidates = candidates.filter((entity) => Boolean(entity.properties.image));
  }

  const area = locate(params);
  if (area !== null) {
    if (!area)
      return fail(400, `Could not find a locality matching "${params.get("filter.location") ?? params.get("filter.location.query")}"`);
    hasFilter = true;
    candidates = candidates.filter((entity) => inArea(entity, area));
  }

  if (!profile.hasSignal && !hasFilter) return fail(400, "at least one valid signal or filter is required");

  const entities = page(rankEntities(candidates, profile, explain), params, 20, 50);
  return respond({ success: true, results: { entities }, duration: 14, _mock: true });
}

function search(params: URLSearchParams): Response {
  const types = list(params, "types");
  if (types.includes("urn:entity:locality")) return searchLocalities(params);
  const query = normalize(params.get("query") ?? "");
  if (!query) return fail(400, "query is required");
  const matches = ENTITIES.filter((entity) => types.length === 0 || types.includes(entity.subtype))
    .map((entity) => {
      const name = normalize(entity.name);
      const score = name === query ? 3 : name.startsWith(query) ? 2 : name.includes(query) || query.includes(name) ? 1 : 0;
      return { entity, score: score + entity.popularity * 0.5 };
    })
    .filter((item) => item.score >= 1)
    .sort((x, y) => y.score - x.score)
    .map((item) => serializeEntity(item.entity));
  if (matches.length === 0) return fail(404, "No results");
  return respond({ success: true, results: page(matches, params, 20, 100), _mock: true });
}

function entities(params: URLSearchParams): Response {
  const ids = new Set(list(params, "entity_ids"));
  const imdb = new Set(list(params, "external.imdb.ids"));
  const spotify = new Set(list(params, "external.spotify.ids"));
  if (ids.size + imdb.size + spotify.size === 0) return fail(400, "entity_ids or an external.*.ids parameter is required");
  const results = ENTITIES.filter(
    (entity) =>
      ids.has(entity.id) ||
      (entity.external?.imdb && imdb.has(entity.external.imdb)) ||
      (entity.external?.spotify && spotify.has(entity.external.spotify)),
  ).map(serializeEntity);
  return respond({ success: true, results, _mock: true });
}

function tags(params: URLSearchParams): Response {
  const query = normalize(params.get("filter.query") ?? "");
  const semantic = params.get("feature.semantic_search") === "true";
  const tagTypes = list(params, "filter.tag.types");
  const parentTypes = list(params, "filter.parents.types");
  const words = query.split(" ").filter(Boolean);
  const matches = TAGS.filter(
    (t) =>
      (tagTypes.length === 0 || tagTypes.includes(t.type)) &&
      (parentTypes.length === 0 || t.parents.some((parent) => parentTypes.includes(parent))),
  )
    .map((t) => {
      const name = normalize(t.name);
      let score = !query ? t.popularity : name === query ? 3 : name.includes(query) ? 2 : 0;
      if (query && score === 0 && semantic) score = words.filter((word) => t.vibes.includes(word)).length * 0.8;
      return { t, score };
    })
    .filter((item) => item.score > 0)
    .sort((x, y) => y.score - x.score || y.t.popularity - x.t.popularity)
    .map(({ t }) => ({ id: t.id, name: t.name, type: t.type, parents: t.parents.map((type) => ({ type })), popularity: t.popularity }));
  return respond({ success: true, results: { tags: page(matches, params, 20, 50) }, _mock: true });
}

function compare(params: URLSearchParams): Response {
  const a = buildProfile(params, "a.");
  const b = buildProfile(params, "b.");
  if (a.entityIds.length === 0 || b.entityIds.length === 0) {
    return fail(400, "a.signal.interests.entities and b.signal.interests.entities are required");
  }
  const scored = TAGS.map((t) => {
    const vector = toVector(t.vibes);
    return { t, score: Math.sqrt(cosine(a.vector, vector) * cosine(b.vector, vector)) };
  })
    .filter((item) => item.score > 0)
    .sort((x, y) => y.score - x.score);
  const tagsOut = page(scored, params, 20, 50).map(({ t, score }) => ({
    tag_id: t.id,
    name: t.name,
    type: "urn:tag",
    subtype: t.type,
    popularity: t.popularity,
    query: { score: round(score) },
  }));
  return respond({ duration: 0.42, results: { tags: tagsOut }, _mock: true });
}

function trending(params: URLSearchParams): Response {
  const start = Date.parse(params.get("filter.start_date") ?? "");
  const end = Date.parse(params.get("filter.end_date") ?? "");
  const entityId = list(params, "signal.interests.entities")[0];
  if (!params.get("filter.type") || Number.isNaN(start) || Number.isNaN(end)) {
    return fail(400, "filter.type, filter.start_date and filter.end_date are required");
  }
  const week = 7 * 24 * 60 * 60 * 1000;
  const points = [];
  for (let t = end; t >= start; t -= week) {
    const date = new Date(t).toISOString().slice(0, 10);
    const percentile = round(50 + unit(`${entityId}:${date}`) * 50);
    points.push({ date, population_percentile: percentile, population_rank: Math.round(1000 - percentile * 9) });
  }
  return respond({ success: true, results: { trending: points }, _mock: true });
}

export function createMockFetch(): FetchLike {
  return async (input, init) => {
    if (init?.method && init.method !== "GET") return fail(404, "No path matching request parameters");
    const url = new URL(input);
    const params = url.searchParams;
    switch (url.pathname) {
      case "/":
        return respond({ version: "mock", title: "Qloo API (mock)", description: "Synthetic fixtures; not Qloo data.", _mock: true });
      case "/search":
        return search(params);
      case "/entities":
        return entities(params);
      case "/v2/insights":
        return insights(params);
      case "/v2/tags":
        return tags(params);
      case "/v2/analysis/compare":
        return compare(params);
      case "/v2/trending":
        return trending(params);
      default:
        return fail(404, "No path matching request parameters");
    }
  };
}
