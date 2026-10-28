// Qloo URN vocabulary. Values follow docs.qloo.com and the official harness;
// where the two disagree, the conflict is noted inline.

export const ENTITY_TYPES = {
  artist: "urn:entity:artist",
  book: "urn:entity:book",
  brand: "urn:entity:brand",
  // Listed in the hackathon guide but absent from the OpenAPI enum: unverified.
  destination: "urn:entity:destination",
  locality: "urn:entity:locality",
  movie: "urn:entity:movie",
  person: "urn:entity:person",
  place: "urn:entity:place",
  podcast: "urn:entity:podcast",
  tv_show: "urn:entity:tv_show",
  // The hackathon guide says `video_game`; the spec and Qloo's own client use `videogame`.
  videogame: "urn:entity:videogame",
} as const;

export type EntityKind = keyof typeof ENTITY_TYPES;
export type EntityUrn = (typeof ENTITY_TYPES)[EntityKind];

/** Special `filter.type` values for /v2/insights that return non-entity results. */
export const INSIGHT_MODES = {
  tag: "urn:tag",
  demographics: "urn:demographics",
  heatmap: "urn:heatmap",
} as const;

export const TAG_TYPES = {
  keyword_media: "urn:tag:keyword:media",
  genre_media: "urn:tag:genre:media",
  genre_music: "urn:tag:genre:music",
  genre_brand: "urn:tag:genre:brand",
  genre_place: "urn:tag:genre:place",
  style: "urn:tag:style:qloo",
  ambience: "urn:tag:ambience:qloo",
  decor: "urn:tag:decor:qloo",
  setting: "urn:tag:setting:qloo",
  amenity_place: "urn:tag:amenity:place",
  /** Film subgenres, film traditions among them (Bollywood, French New Wave): read_audience's era leg. */
  subgenre: "urn:tag:subgenre:qloo",
} as const;

export type TagKind = keyof typeof TAG_TYPES;

/** Qloo's tag for actors (urn:tag:occupation:qloo:actor, which /v2/tags offers, matches nobody: live, 2026-10-28). */
export const ACTOR_TAG = "urn:tag:genre:person:actor";

/**
 * People Qloo also tags as influencers, YouTubers, reality-TV names, TV personalities, athletes or musicians: casting
 * references are actors, and live these crowded the actors out (Love Island names among Aftersun's audience).
 */
export const CASTING_EXCLUDED_TAGS = [
  "urn:tag:genre:person:influencer",
  "urn:tag:occupation:person:influencer",
  "urn:tag:genre:person:youtuber",
  "urn:tag:occupation:person:youtuber",
  "urn:tag:occupation:person:video_blogger",
  "urn:tag:occupation:person:reality_television_participant",
  "urn:tag:occupation:person:television_personality",
  "urn:tag:genre:person:athlete",
  "urn:tag:genre:person:musician",
] as const;

export const AGE_BUCKETS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"] as const;

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export function entityUrn(kind: EntityKind): EntityUrn {
  return ENTITY_TYPES[kind];
}

export function kindFromUrn(urn: string | undefined): EntityKind | undefined {
  if (!urn) return undefined;
  const match = (Object.entries(ENTITY_TYPES) as [EntityKind, string][]).find(([, value]) => value === urn);
  return match?.[0];
}
