import { z } from "zod";
import {
  AGE_BUCKETS,
  INSIGHT_MODES,
  QlooError,
  TAG_TYPES,
  compactTag,
  entityUrn,
  tagList,
  type DemographicsBlock,
  type InsightsResponse,
} from "../qloo";
import { mockEntityId } from "../qloo/mock/catalog";
import { SEARCHABLE_KINDS, TAG_KIND_VALUES, defineTool, entityIds, plural, take } from "./shared";

export const findTags = defineTool({
  name: "find_tags",
  description:
    'Translate a mood, style or concept (e.g. "neon", "melancholic", "art deco", "rooftop", "streetwear") into Qloo ' +
    "tag IDs. Call this before using any concept as a signal or filter: Qloo rejects free-text tags. Results are ranked " +
    "candidates, not proof; prefer tags whose applies_to includes the entity type you will query next.",
  inputSchema: z.strictObject({
    query: z.string().min(1).max(80).describe("The concept in plain words."),
    applies_to: z
      .enum(SEARCHABLE_KINDS)
      .optional()
      .describe("Only return tags usable for this entity type, e.g. place for location ambience."),
    tag_types: z
      .array(z.enum(TAG_KIND_VALUES))
      .max(6)
      .optional()
      .describe("Restrict to tag families, e.g. ambience, decor and setting for locations, or keyword_media for film themes."),
    take: take(8, 20),
  }),
  example: { query: "neon", applies_to: "movie" },
  async run(input, { qloo }) {
    const response = await qloo.tags({
      "filter.query": input.query,
      "feature.semantic_search": true,
      "filter.tag.types": input.tag_types?.map((kind) => TAG_TYPES[kind]),
      "filter.parents.types": input.applies_to ? entityUrn(input.applies_to) : undefined,
      take: input.take,
    });
    const tags = tagList(response.data).map((tag) => ({
      ...compactTag(tag),
      applies_to: tag.parents?.map((parent) => parent.type),
    }));
    return {
      status: tags.length > 0 ? "ok" : "empty",
      summary:
        tags.length > 0
          ? `${plural(tags.length, "tag candidate")} for "${input.query}": ${tags
              .slice(0, 5)
              .map((t) => t.name)
              .join(", ")}.`
          : `No tags matched "${input.query}"; try a simpler or different word.`,
      data: { tags },
    };
  },
});

function leans(block: DemographicsBlock): string {
  const age = block.query.age ?? {};
  const topAges = AGE_BUCKETS.filter((bucket) => (age[bucket] ?? 0) > 0)
    .sort((x, y) => (age[y] ?? 0) - (age[x] ?? 0))
    .slice(0, 2)
    .map((bucket) => bucket.replaceAll("_", " "));
  const male = block.query.gender?.male ?? 0;
  const gender = male > 0.05 ? "skews male" : male < -0.05 ? "skews female" : "gender-balanced";
  return `${topAges.length > 0 ? `over-indexes ${topAges.join(" and ")}` : "no clear age skew"}, ${gender}`;
}

export const readAudience = defineTool({
  name: "read_audience",
  description:
    "Describe who loves the given entities: the taste vocabulary their audience over-indexes on (Qloo taste tags such as " +
    "themes, genres, styles and ambiences) plus age and gender skew. Call this early in a treatment, right after resolving " +
    "the artist or touchstones, to ground tone, references, wardrobe and locations in the real audience. These are " +
    "aggregate affinities, never facts about any individual.",
  inputSchema: z.strictObject({
    entity_ids: entityIds(10),
    tag_types: z
      .array(z.enum(TAG_KIND_VALUES))
      .max(8)
      .default(["keyword_media", "genre_media", "genre_music", "style", "ambience"])
      .describe("Tag families to describe the audience with."),
    take: take(15, 30),
  }),
  example: { entity_ids: [mockEntityId("Prateek Kuhad")] },
  async run(input, { qloo }) {
    const warnings: string[] = [];
    const [tagsResponse, demographics] = await Promise.all([
      qloo.insights({
        "filter.type": INSIGHT_MODES.tag,
        "signal.interests.entities": input.entity_ids,
        "filter.tag.types": input.tag_types.map((kind) => TAG_TYPES[kind]),
        take: input.take,
      }),
      qloo
        .insights({ "filter.type": INSIGHT_MODES.demographics, "signal.interests.entities": input.entity_ids })
        .then((r) => (r.data as InsightsResponse).results?.demographics ?? [])
        .catch((err: unknown) => {
          if (!(err instanceof QlooError)) throw err;
          warnings.push(`Demographics unavailable: ${err.message}`);
          return [] as DemographicsBlock[];
        }),
    ]);
    // Qloo can return one word in two tag families ("India" genre, "india" keyword); keep the stronger one.
    const seen = new Set<string>();
    const tasteTags = tagList(tagsResponse.data)
      .map(compactTag)
      .filter((tag) => {
        const key = tag.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const audience = demographics.map((block) => ({ entity_id: block.entity_id, ...block.query, leans: leans(block) }));
    return {
      status: tasteTags.length + audience.length > 0 ? "ok" : "empty",
      summary:
        `Audience over-indexes on ${
          tasteTags
            .slice(0, 6)
            .map((t) => t.name)
            .join(", ") || "no clear tags"
        }.` + (audience[0] ? ` ${audience[0].leans}.` : ""),
      data: { taste_tags: tasteTags, demographics: audience },
      warnings,
    };
  },
});

export const tasteOverlap = defineTool({
  name: "taste_overlap",
  description:
    "Find the taste traits two groups share, e.g. the director's own favourite films versus the artist (or the artist's " +
    "touchstones), to locate the creative sweet spot: the director's voice inside the audience's taste. Call this once both " +
    "sides are resolved. Higher score means both sides index strongly on that trait.",
  inputSchema: z.strictObject({
    group_a_ids: entityIds(25).describe("Side A, typically the director's own films or references."),
    group_b_ids: entityIds(25).describe("Side B, typically the artist or the client's touchstones."),
    take: take(12, 30),
  }),
  example: {
    group_a_ids: [mockEntityId("In the Mood for Love"), mockEntityId("Donnie Darko"), mockEntityId("Rockstar")],
    group_b_ids: [mockEntityId("Prateek Kuhad")],
  },
  async run(input, { qloo }) {
    const response = await qloo.compare({
      "a.signal.interests.entities": input.group_a_ids,
      "b.signal.interests.entities": input.group_b_ids,
      take: input.take,
    });
    const traits = tagList(response.data).map(compactTag);
    return {
      status: traits.length > 0 ? "ok" : "empty",
      summary:
        traits.length > 0
          ? `Shared traits: ${traits
              .slice(0, 6)
              .map((t) => t.name)
              .join(", ")}.`
          : "No shared traits found between the two groups.",
      data: { shared_traits: traits },
    };
  },
});
