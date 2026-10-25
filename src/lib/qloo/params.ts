import type { QlooParams } from "./types";

/**
 * Serialize params the way Qloo's GET endpoints expect: arrays comma-joined
 * into one value, booleans as "true"/"false", empty values dropped, keys sorted
 * so the result doubles as a stable cache key.
 */
export function serializeParams(params: QlooParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const parts = value.map(String).filter((part) => part.length > 0);
      if (parts.length > 0) out[key] = parts.join(",");
    } else {
      const str = String(value);
      if (str.length > 0) out[key] = str;
    }
  }
  return out;
}

export function cacheKey(path: string, query: Record<string, string>): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

// Qloo silently ignores parameters that don't apply to a filter.type, which
// usually shows up as a 200 with no results. These allowlists come from the
// Entity Type Parameter Guide plus parameters the Parameter Reference marks as
// valid for all types. The guide is known to be incomplete, so mismatches are
// reported as warnings rather than errors.
const ALWAYS = ["filter.type", "take", "page", "offset", "feature.explainability"];

const SIGNALS = [
  "signal.interests.entities",
  "signal.interests.entities.weight",
  "signal.interests.tags",
  "signal.interests.tags.weight",
  "operator.signal.interests.tags",
  "signal.demographics.age",
  "signal.demographics.age.weight",
  "signal.demographics.gender",
  "signal.demographics.gender.weight",
  "signal.demographics.audiences",
  "signal.demographics.audiences.weight",
  "signal.location",
  "signal.location.query",
  "signal.location.radius",
  "signal.location.weight",
];

const COMMON = [
  ...ALWAYS,
  ...SIGNALS,
  "bias.trends",
  "filter.exclude.entities",
  "filter.exclude.tags",
  "operator.exclude.tags",
  "operator.filter.exclude.tags",
  "filter.external.exists",
  "operator.filter.external.exists",
  "filter.exists",
  "filter.parents.types",
  "filter.popularity.min",
  "filter.popularity.max",
  "filter.results.entities",
  "filter.results.entities.query",
  "filter.tags",
  "operator.filter.tags",
];

const MOVIE = [
  "filter.content_rating",
  "filter.release_year.min",
  "filter.release_year.max",
  "filter.release_date.min",
  "filter.release_date.max",
  "filter.release_country",
  "operator.filter.release_country",
  "filter.rating.min",
  "filter.rating.max",
];

const GEO = [
  "filter.geocode.name",
  "filter.geocode.admin1_region",
  "filter.geocode.admin2_region",
  "filter.geocode.country_code",
  "filter.location",
  "filter.location.query",
  "filter.location.radius",
  "filter.location.geohash",
  "filter.location.metro",
  "filter.exclude.location",
  "filter.exclude.location.query",
  "filter.exclude.location.radius",
  "filter.exclude.location.geohash",
];

const PLACE = [
  ...GEO,
  "bias.quality",
  "filter.address",
  "filter.external.tripadvisor.rating.min",
  "filter.external.tripadvisor.rating.max",
  "filter.external.tripadvisor.rating.count.min",
  "filter.external.tripadvisor.rating.count.max",
  "filter.hotel_class.min",
  "filter.hotel_class.max",
  "filter.hours",
  "filter.price_level.min",
  "filter.price_level.max",
  "filter.price_range.from",
  "filter.price_range.to",
  "filter.properties.business_rating.min",
  "filter.properties.business_rating.max",
  "filter.references_brand",
  "operator.filter.references_brand",
  "sort_by",
  "diversify.by",
  "diversify.take",
];

const ALLOWED: Record<string, ReadonlySet<string>> = {
  "urn:entity:artist": new Set(COMMON),
  "urn:entity:brand": new Set(COMMON),
  "urn:entity:podcast": new Set(COMMON),
  "urn:entity:videogame": new Set(COMMON),
  "urn:entity:book": new Set([...COMMON, "filter.publication_year.min", "filter.publication_year.max"]),
  "urn:entity:movie": new Set([...COMMON, ...MOVIE]),
  "urn:entity:tv_show": new Set([
    ...COMMON,
    ...MOVIE,
    "filter.finale_year.min",
    "filter.finale_year.max",
    "filter.latest_known_year.min",
    "filter.latest_known_year.max",
  ]),
  "urn:entity:person": new Set([
    ...COMMON,
    "filter.date_of_birth.min",
    "filter.date_of_birth.max",
    "filter.date_of_death.min",
    "filter.date_of_death.max",
    "filter.gender",
  ]),
  "urn:entity:place": new Set([...COMMON, ...PLACE]),
  "urn:entity:destination": new Set([...COMMON, ...GEO]),
  "urn:heatmap": new Set([
    ...ALWAYS,
    ...SIGNALS,
    "bias.trends",
    "filter.location",
    "filter.location.query",
    "filter.location.radius",
    "heatmap.dimensions",
    "filter.dimensions.hotel_class",
    "filter.dimensions.price_level",
    "output.heatmap.boundary",
  ]),
  "urn:tag": new Set([
    ...ALWAYS,
    ...SIGNALS,
    "diversify.by",
    "diversify.take",
    "filter.tag.types",
    "filter.parents.types",
    "filter.results.tags",
  ]),
  "urn:demographics": new Set([...ALWAYS, "signal.interests.entities", "signal.interests.tags"]),
};

export function validateInsightsParams(query: Record<string, string>): string[] {
  const type = query["filter.type"];
  if (!type) return ["filter.type is required for /v2/insights."];
  const allowed = ALLOWED[type];
  if (!allowed) return [];
  return Object.keys(query)
    .filter((key) => !allowed.has(key))
    .map((key) => `"${key}" is not documented for filter.type=${type}; Qloo may silently ignore it.`);
}
