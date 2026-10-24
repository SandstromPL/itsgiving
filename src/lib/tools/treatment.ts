import { z } from "zod";
import { WEEKDAYS, compactEntity, entityList, entityUrn, type QlooParams } from "../qloo";
import { mockEntityId } from "../qloo/mock/catalog";
import { defineTool, entityIds, plural, tagIds, take } from "./shared";

// The tools that fill a treatment: reference films, wardrobe and locations.
// All three request feature.explainability so every pick carries the input
// entities that drove it ("because fans of X over-index on this").

const tagMode = z
  .enum(["bias", "require"])
  .describe("bias: tags shift the ranking but nothing is excluded. require: only return results carrying at least one tag.");

function tagParams(ids: string[] | undefined, mode: "bias" | "require"): QlooParams {
  if (!ids || ids.length === 0) return {};
  return mode === "require"
    ? { "filter.tags": ids, "operator.filter.tags": "union" }
    : { "signal.interests.tags": ids, "operator.signal.interests.tags": "union" };
}

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
      ...tagParams(input.signal_tag_ids, "bias"),
      "filter.release_year.min": input.from_year,
      "filter.release_year.max": input.to_year,
      "filter.popularity.min": input.min_popularity,
      "filter.popularity.max": input.max_popularity,
      "filter.exclude.entities": input.exclude_ids,
      "feature.explainability": true,
      take: input.take,
    });
    const references = entityList(response.data).map((e) => compactEntity(e));
    return {
      status: references.length > 0 ? "ok" : "empty",
      summary:
        references.length > 0
          ? `${plural(references.length, "reference")}: ${references.slice(0, 5).map((r) => `${r.name}${r.year ? ` (${r.year})` : ""}`).join(", ")}.`
          : "No references matched; widen the era or raise max_popularity.",
      data: { references },
      warnings: response.warnings,
    };
  },
});

export const stylingBrands = defineTool({
  name: "styling_brands",
  description:
    "Find fashion and lifestyle brands the audience of the given entities over-indexes on, to brief wardrobe and styling. " +
    "Call this when planning costume or wardrobe. Optionally steer with style tag IDs from find_tags (e.g. streetwear, " +
    "vintage, minimalist).",
  inputSchema: z.strictObject({
    signal_entity_ids: entityIds(10).describe("The artist and/or touchstones whose audience the styling should fit."),
    style_tag_ids: tagIds(10).optional(),
    tag_mode: tagMode.default("bias"),
    take: take(10, 20),
  }),
  example: { signal_entity_ids: [mockEntityId("Charli xcx")] },
  async run(input, { qloo }) {
    const response = await qloo.insights({
      "filter.type": entityUrn("brand"),
      "signal.interests.entities": input.signal_entity_ids,
      ...tagParams(input.style_tag_ids, input.tag_mode),
      "feature.explainability": true,
      take: input.take,
    });
    const brands = entityList(response.data).map((e) => compactEntity(e, { maxTags: 5 }));
    return {
      status: brands.length > 0 ? "ok" : "empty",
      summary:
        brands.length > 0
          ? `${plural(brands.length, "brand")}: ${brands.slice(0, 6).map((b) => b.name).join(", ")}.`
          : "No brands matched; try tag_mode=bias or fewer style tags.",
      data: { brands },
      warnings: response.warnings,
    };
  },
});

export const scoutLocations = defineTool({
  name: "scout_locations",
  description:
    "Shortlist real places in the shoot city (cafés, bars, restaurants, venues, hotels) whose ambience fits the treatment " +
    "and whose regulars share the audience's taste, with photos where available. Call this when planning locations. Pass " +
    "ambience, decor or setting tag IDs from find_tags (applies_to: place) and price_level_max for budget. Results are " +
    "candidates to scout: availability and filming permission must be confirmed with each venue.",
  inputSchema: z.strictObject({
    city: z.string().min(1).describe("City or neighbourhood name, e.g. \"Mumbai\", \"Bandra\" or \"New York City\"."),
    signal_entity_ids: z
      .array(z.string().min(1))
      .max(10)
      .optional()
      .describe("Artist/touchstone entity IDs; ranks places by how much their audience likes them."),
    ambience_tag_ids: tagIds(10).optional(),
    tag_mode: tagMode.default("require"),
    require_photo: z.boolean().default(true).describe("Only return places that have a photo."),
    price_level_max: z.number().int().min(1).max(4).optional().describe("Budget ceiling on Qloo's 1-4 price level."),
    open_on: z.enum(WEEKDAYS).optional().describe("Only places open on this day (e.g. the shoot day)."),
    take: take(10, 20),
  }),
  example: {
    city: "Mumbai",
    signal_entity_ids: [mockEntityId("Prateek Kuhad")],
    ambience_tag_ids: ["urn:tag:ambience:qloo:intimate", "urn:tag:ambience:qloo:cozy"],
  },
  async run(input, { qloo }) {
    const response = await qloo.insights({
      "filter.type": entityUrn("place"),
      "filter.location.query": input.city,
      "signal.interests.entities": input.signal_entity_ids,
      ...tagParams(input.ambience_tag_ids, input.tag_mode),
      "filter.exists": input.require_photo ? "properties.image" : undefined,
      "filter.price_level.max": input.price_level_max,
      "filter.hours": input.open_on,
      "feature.explainability": true,
      take: input.take,
    });
    const locations = entityList(response.data).map((e) => compactEntity(e, { maxTags: 6 }));
    const relax = [
      input.tag_mode === "require" && input.ambience_tag_ids?.length ? "tag_mode=bias" : undefined,
      input.require_photo ? "require_photo=false" : undefined,
      input.price_level_max ? "a higher price_level_max" : undefined,
    ].filter(Boolean);
    return {
      status: locations.length > 0 ? "ok" : "empty",
      summary:
        locations.length > 0
          ? `${plural(locations.length, "location")} in ${input.city}: ${locations.slice(0, 5).map((l) => l.name).join(", ")}. Confirm availability and filming permission with each venue.`
          : `No locations matched in ${input.city}.${relax.length > 0 ? ` Try ${relax.join(", ")}.` : ""}`,
      data: { locations },
      warnings: response.warnings,
    };
  },
});
