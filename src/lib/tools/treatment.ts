import { z } from "zod";
import { WEEKDAYS, compactEntity, entityList, entityUrn, type QlooParams } from "../qloo";
import { mockEntityId } from "../qloo/mock/catalog";
import { VENUE_KIND_VALUES, defineTool, entityIds, plural, tagIds, take, venueTagIds } from "./shared";

// The tools that fill a treatment: reference films, wardrobe and locations.
// They request feature.explainability so each pick carries the input entities
// that drove it ("because fans of X over-index on this"), except where that is
// slow: on the hackathon host (2026-10-25) explainability plus tag signals took
// 22-57 s for films and up to 43 s for brands, against 1-4 s without it.

/** Tags as a ranking signal: they shift the order, never exclude anything. */
function tagBias(ids: string[] | undefined): QlooParams {
  return ids && ids.length > 0 ? { "signal.interests.tags": ids, "operator.signal.interests.tags": "union" } : {};
}

/**
 * Chain branches come back as separate places ("Starbucks - Juhu Tara Road", "Starbucks - Vile Parle West").
 * Keep the best-ranked branch of each name, in Qloo's order, so a shortlist isn't three of the same café.
 */
export function oneBranchEach<T extends { name: string }>(places: T[]): T[] {
  const seen = new Set<string>();
  return places.filter((place) => {
    const brand = place.name
      .split(/\s+[-|–(]\s*/)[0]
      .trim()
      .toLowerCase();
    if (seen.has(brand)) return false;
    seen.add(brand);
    return true;
  });
}

/** Brands carry this parent genre when they make clothing; without it "wardrobe" also returned snack and drink brands. */
export const FASHION_GENRE = "urn:tag:genre:brand:fashion";

export const referenceFilms = defineTool({
  name: "reference_films",
  description:
    "Find films (or TV shows) that the audience of the given entities over-indexes on: the visual and tonal references " +
    "for a treatment or lookbook. Call this after resolve_entities (and ideally read_audience). Use max_popularity around " +
    "0.6-0.8 to surface deep cuts instead of the canon, from_year/to_year to pin an era, and exclude_ids to drop titles " +
    "already shown. Each result lists which input entities drove it.",
  inputSchema: z.strictObject({
    signal_entity_ids: entityIds(10).describe("The artist and/or touchstones whose audience the references should fit."),
    signal_tag_ids: tagIds(10).optional(),
    kind: z.enum(["movie", "tv_show"]).default("movie").describe("Films or TV shows."),
    from_year: z.number().int().min(1890).max(2100).optional().describe("Earliest release year."),
    to_year: z.number().int().min(1890).max(2100).optional().describe("Latest release year."),
    min_popularity: z.number().min(0).max(1).optional().describe("Popularity percentile floor, 0-1."),
    max_popularity: z.number().min(0).max(1).optional().describe("Popularity percentile ceiling, 0-1; lower means deeper cuts."),
    exclude_ids: z.array(z.string().min(1)).max(50).optional().describe("Entity IDs to leave out."),
    take: take(10, 20),
  }),
  example: { signal_entity_ids: [mockEntityId("Prateek Kuhad")], max_popularity: 0.9 },
  async run(input, { qloo }) {
    const response = await qloo.insights({
      "filter.type": entityUrn(input.kind),
      "signal.interests.entities": input.signal_entity_ids,
      ...tagBias(input.signal_tag_ids),
      "filter.release_year.min": input.from_year,
      "filter.release_year.max": input.to_year,
      "filter.popularity.min": input.min_popularity,
      "filter.popularity.max": input.max_popularity,
      "filter.exclude.entities": input.exclude_ids,
      "feature.explainability": !input.signal_tag_ids?.length,
      take: input.take,
    });
    const references = entityList(response.data).map((e) => compactEntity(e));
    return {
      status: references.length > 0 ? "ok" : "empty",
      summary:
        references.length > 0
          ? `${plural(references.length, "reference")}: ${references
              .slice(0, 5)
              .map((r) => `${r.name}${r.year ? ` (${r.year})` : ""}`)
              .join(", ")}.`
          : "No references matched; widen the era or raise max_popularity.",
      data: { references },
      warnings: response.warnings,
    };
  },
});

export const stylingBrands = defineTool({
  name: "styling_brands",
  description:
    "Find fashion brands the audience of the given entities over-indexes on, to brief wardrobe and styling. Call this " +
    "when planning costume or wardrobe. Optionally steer the ranking with style tag IDs from find_tags (e.g. streetwear, " +
    "vintage, minimalist); they shift the order but never add non-fashion brands.",
  inputSchema: z.strictObject({
    signal_entity_ids: entityIds(10).describe("The artist and/or touchstones whose audience the styling should fit."),
    style_tag_ids: tagIds(10).optional(),
    fashion_only: z.boolean().default(true).describe("Only brands Qloo files under fashion (clothing, shoes, accessories)."),
    take: take(10, 20),
  }),
  example: { signal_entity_ids: [mockEntityId("Charli xcx")] },
  async run(input, { qloo }) {
    const response = await qloo.insights({
      "filter.type": entityUrn("brand"),
      "signal.interests.entities": input.signal_entity_ids,
      ...(input.fashion_only ? { "filter.tags": FASHION_GENRE } : {}),
      ...tagBias(input.style_tag_ids),
      "feature.explainability": !input.style_tag_ids?.length,
      take: input.take,
    });
    const brands = entityList(response.data).map((e) => compactEntity(e, { maxTags: 5 }));
    return {
      status: brands.length > 0 ? "ok" : "empty",
      summary:
        brands.length > 0
          ? `${plural(brands.length, "brand")}: ${brands
              .slice(0, 6)
              .map((b) => b.name)
              .join(", ")}.`
          : `No brands matched;${input.fashion_only ? " try fashion_only=false or" : " try"} fewer style tags.`,
      data: { brands },
      warnings: response.warnings,
    };
  },
});

export const scoutLocations = defineTool({
  name: "scout_locations",
  description:
    "Shortlist real places in the shoot city whose kind and ambience fit the treatment and whose regulars share the " +
    "audience's taste, with photos where available. Call this when planning locations. venue_kinds filters to filmable " +
    "kinds of place (cafe, bar, bookstore, park...); ambience_tag_ids from find_tags (applies_to: place) rank places by " +
    "mood; price_level_max keeps to the budget; near keeps to one area, e.g. a shoot base from audience_heatmap. " +
    "Results are candidates to scout: availability and filming permission must be confirmed with each venue.",
  inputSchema: z.strictObject({
    city: z.string().min(1).describe('City or neighbourhood name, e.g. "Mumbai", "Bandra" or "New York City".'),
    locality_id: z
      .string()
      .min(1)
      .optional()
      .describe("The city's Qloo ID from resolve_entities (type locality); more exact than the name."),
    near: z
      .strictObject({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radius_m: z.number().int().min(200).max(20_000),
      })
      .optional()
      .describe("Only places within radius_m metres of this point, e.g. an area from audience_heatmap."),
    signal_entity_ids: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe("Artist/touchstone entity IDs; ranks places by how much their audience likes them."),
    venue_kinds: z
      .array(z.enum(VENUE_KIND_VALUES))
      .min(1)
      .max(VENUE_KIND_VALUES.length)
      .optional()
      .describe("Only return these kinds of place. Leave out to allow any place, including hotels and offices."),
    ambience_tag_ids: tagIds(10)
      .optional()
      .describe("Ambience, decor or setting tag IDs from find_tags; they rank places, never exclude them."),
    require_photo: z.boolean().default(true).describe("Only return places that have a photo."),
    price_level_max: z.number().int().min(1).max(4).optional().describe("Budget ceiling on Qloo's 1-4 price level."),
    open_on: z.enum(WEEKDAYS).optional().describe("Only places open on this day (e.g. the shoot day)."),
    take: take(10, 20),
  }),
  example: {
    city: "Mumbai",
    signal_entity_ids: [mockEntityId("Prateek Kuhad")],
    venue_kinds: ["cafe", "bar"],
    ambience_tag_ids: ["urn:tag:ambience:qloo:intimate", "urn:tag:ambience:qloo:cozy"],
  },
  async run(input, { qloo }) {
    const response = await qloo.insights({
      "filter.type": entityUrn("place"),
      // WKT puts longitude first. A locality ID or a name covers the whole city.
      ...(input.near
        ? { "filter.location": `POINT(${input.near.lon} ${input.near.lat})`, "filter.location.radius": input.near.radius_m }
        : input.locality_id
          ? { "filter.location": input.locality_id }
          : { "filter.location.query": input.city }),
      "signal.interests.entities": input.signal_entity_ids,
      // Venue kind filters and mood ranks: one filter.tags operator can't mean "any of these kinds AND this mood".
      ...(input.venue_kinds ? { "filter.tags": venueTagIds(input.venue_kinds), "operator.filter.tags": "union" } : {}),
      ...tagBias(input.ambience_tag_ids),
      "filter.exists": input.require_photo ? "properties.image" : undefined,
      "filter.price_level.max": input.price_level_max,
      "filter.hours": input.open_on,
      "feature.explainability": true,
      // A few spare results, since repeated chain branches are dropped below.
      take: Math.min(input.take + 4, 24),
    });
    const locations = oneBranchEach(entityList(response.data).map((e) => compactEntity(e, { maxTags: 6 }))).slice(0, input.take);
    const where = input.near ? `within ${input.near.radius_m / 1000} km of the given point in ${input.city}` : `in ${input.city}`;
    const relax = [
      input.near ? "a wider radius_m or no near" : undefined,
      input.venue_kinds && input.venue_kinds.length < VENUE_KIND_VALUES.length ? "more venue_kinds" : undefined,
      input.require_photo ? "require_photo=false" : undefined,
      input.price_level_max ? "a higher price_level_max" : undefined,
    ].filter(Boolean);
    return {
      status: locations.length > 0 ? "ok" : "empty",
      summary:
        locations.length > 0
          ? `${plural(locations.length, "location")} ${where}: ${locations
              .slice(0, 5)
              .map((l) => l.name)
              .join(", ")}. Confirm availability and filming permission with each venue.`
          : `No locations matched ${where}.${relax.length > 0 ? ` Try ${relax.join(", ")}.` : ""}`,
      data: { locations },
      warnings: response.warnings,
    };
  },
});
