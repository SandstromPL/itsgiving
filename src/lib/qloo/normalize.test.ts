import { describe, expect, it } from "vitest";
import { audienceList, compactEntity, entityList, extractContributions, pickTags, tagList } from "./normalize";

describe("result readers", () => {
  it("read entities from both the flat and the wrapped shapes", () => {
    const entity = { name: "Se7en", entity_id: "X" };
    expect(entityList({ results: [entity] })).toEqual([entity]);
    expect(entityList({ results: { entities: [entity] } })).toEqual([entity]);
    expect(entityList(undefined)).toEqual([]);
  });

  it("read tags and audiences from the documented variants", () => {
    expect(tagList({ results: { tags: [{ name: "Neon" }] } })).toHaveLength(1);
    expect(audienceList({ results: { audiences: [{ id: "a", name: "A" }] } })).toHaveLength(1);
    expect(audienceList({ results: { entities: [{ id: "b", name: "B" }] } })).toHaveLength(1);
  });
});

describe("extractContributions", () => {
  it("finds entity/score pairs wherever they sit in explainability", () => {
    const contributions = extractContributions({
      "signal.interests.entities": [
        { entity_id: "A", score: 0.25 },
        { entity_id: "B", score: 0.75 },
      ],
      nested: { deeper: [{ id: "C", weight: 0.1 }] },
    });
    expect(contributions.map((c) => c.entity_id)).toEqual(["B", "A", "C"]);
  });
});

describe("compactEntity", () => {
  it("keeps the useful fields and drops verbose ones", () => {
    const compact = compactEntity({
      name: "Balthazar",
      entity_id: "P1",
      subtype: "urn:entity:place",
      popularity: 0.9987,
      properties: {
        akas: [{ value: "x".repeat(1000) }],
        image: { url: "https://images.qloo.com/i/p1.jpg" },
        geocode: { city: "New York", country_code: "US" },
        price_level: 3,
        description: "d".repeat(400),
      },
      tags: Array.from({ length: 12 }, (_, i) => ({ id: `urn:tag:t:${i}`, name: `Tag ${i}` })),
      query: { affinity: 0.91234, explainability: { x: [{ entity_id: "S", score: 1 }] } },
      external: { imdb: [{ id: "tt1" }] },
    });
    expect(compact).toMatchObject({
      id: "P1",
      kind: "place",
      image: "https://images.qloo.com/i/p1.jpg",
      popularity: 0.999,
      affinity: 0.912,
      place: { city: "New York", country_code: "US", price_level: 3 },
      because: [{ entity_id: "S", score: 1 }],
      external: { imdb: "tt1" },
    });
    expect(compact.tags).toHaveLength(8);
    expect(compact.description!.length).toBeLessThanOrEqual(240);
    expect(JSON.stringify(compact)).not.toContain("akas");
  });

  it("reads live place fields: top-level location, primary genre object and Qloo's ambience note", () => {
    const compact = compactEntity({
      name: "Rarities",
      entity_id: "P2",
      subtype: "urn:entity:place",
      location: { lat: 40.76, lon: -73.97, geohash: "dr5ru" },
      properties: {
        primary_genre: { id: "urn:tag:genre:place:restaurant:lounge_bar", name: "Lounge bar" },
        ambience_description: "Gilded Age glamour with velvet furnishings.",
      },
    });
    expect(compact.place).toMatchObject({ kind: "Lounge bar", ambience: "Gilded Age glamour with velvet furnishings.", lat: 40.76, lon: -73.97 });
  });

  it("puts a film's style tags first and drops noise and generic labels", () => {
    const tag = (type: string, name: string) => ({ id: `${type}:${name}`, name, type });
    const tags = [
      tag("urn:tag:keyword:media", "Smoothie"),
      tag("urn:tag:keyword:media", "Pencil sharpener"),
      tag("urn:tag:genre:media", "Drama"),
      tag("urn:tag:style:qloo", "Stark close ups"),
      tag("urn:tag:style:qloo", "Moody"),
      tag("urn:tag:plot:qloo", "Slow burn"),
    ];
    expect(pickTags(tags, "movie", 4)).toEqual(["Stark close ups", "Moody", "Drama", "Slow burn"]);
    expect(pickTags([tag("urn:tag:genre:place", "Place"), tag("urn:tag:genre:place", "Cafe")], "place", 4)).toEqual(["Cafe"]);
    // Without priority families (e.g. mock data), Qloo's own order is kept.
    expect(pickTags(tags.slice(0, 2), "movie", 4)).toEqual(["Smoothie", "Pencil sharpener"]);
  });

  it("keeps a null affinity (no signal) distinct from a missing one", () => {
    expect(compactEntity({ name: "A", entity_id: "1", query: { affinity: null } }).affinity).toBeNull();
    expect(compactEntity({ name: "A", entity_id: "1" }).affinity).toBeUndefined();
  });
});
