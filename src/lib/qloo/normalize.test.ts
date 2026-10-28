import { describe, expect, it } from "vitest";
import { compactEntity, entityList, extractContributions, pickTags, tagList } from "./normalize";

describe("result readers", () => {
  it("read entities from both the flat and the wrapped shapes", () => {
    const entity = { name: "Se7en", entity_id: "X" };
    expect(entityList({ results: [entity] })).toEqual([entity]);
    expect(entityList({ results: { entities: [entity] } })).toEqual([entity]);
    expect(entityList(undefined)).toEqual([]);
  });

  it("read tags from the documented variants", () => {
    expect(tagList({ results: { tags: [{ name: "Neon" }] } })).toHaveLength(1);
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
  it("reads external IDs from either place live Qloo has put them", () => {
    const older = { name: "Se7en", entity_id: "A", external: { imdb: [{ id: "tt0114369" }] } };
    const newer = {
      name: "In the Mood for Love",
      entity_id: "B",
      properties: { external: { imdb: { id: "tt0118694", user_rating: 8 }, wikidata: { id: "Q1056853" } } },
    };
    expect(compactEntity(older).external?.imdb).toBe("tt0114369");
    expect(compactEntity(newer).external?.imdb).toBe("tt0118694");
  });

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
    expect(compact.place).toMatchObject({
      kind: "Lounge bar",
      ambience: "Gilded Age glamour with velvet furnishings.",
      lat: 40.76,
      lon: -73.97,
    });
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

describe("compactEntity names", () => {
  it("tidies the spacing around commas, and leaves numbers alone", () => {
    expect(compactEntity({ name: "Poco Loco Tapas & Bar ,Khar", entity_id: "1" }).name).toBe("Poco Loco Tapas & Bar, Khar");
    expect(compactEntity({ name: "Cafe 1,000  Steps", entity_id: "2" }).name).toBe("Cafe 1,000 Steps");
  });
});

describe("compactEntity details a director can use", () => {
  it("keeps a place's hours, contact, setting, best times of day and view, and nothing about its customers", () => {
    const compact = compactEntity({
      name: "Thalassa",
      entity_id: "P2",
      subtype: "urn:entity:place",
      properties: {
        hours: {
          monday: [{ opens: null, closed: true, closes: null }],
          tuesday: [{ opens: "T12:00:00", closed: false, closes: "T01:30:00" }],
          friday: [
            { opens: "T12:00:00", closed: false, closes: "T15:30:00" },
            { opens: "T19:00:00", closed: false, closes: "T23:30:00" },
          ],
        },
        phone: "+91 22 2600 0000",
        website: "https://thalassa.example/",
        physical_setting_description: "A whitewashed terrace above Carter Road, open to the sea breeze.",
        customer_demographics_description: "Mostly couples in their thirties.",
      },
      tags: [
        { id: "urn:tag:time_of_day_fit:qloo:evening", name: "Evening", type: "urn:tag:time_of_day_fit:qloo" },
        { id: "urn:tag:view:qloo:waterfront", name: "Waterfront view", type: "urn:tag:view:qloo" },
        { id: "urn:tag:customer_identity:qloo:couples", name: "Couples", type: "urn:tag:customer_identity:qloo" },
      ],
    });
    expect(compact.place).toMatchObject({
      hours: { monday: "closed", tuesday: "12:00–01:30", friday: "12:00–15:30, 19:00–23:30" },
      phone: "+91 22 2600 0000",
      website: "https://thalassa.example/",
      setting: "A whitewashed terrace above Carter Road, open to the sea breeze.",
      fits: ["Evening"],
      views: ["Waterfront view"],
    });
    expect(compact.place?.hours).not.toHaveProperty("wednesday");
    expect(JSON.stringify(compact)).not.toContain("thirties");
  });

  it("links only to http and https, and keeps only a phone number that dials", () => {
    const place = (website: unknown, phone: unknown) =>
      compactEntity({ name: "X", entity_id: "P3", subtype: "urn:entity:place", properties: { website, phone } }).place;
    expect(place("javascript:alert(1)", "call us")).toMatchObject({ website: undefined, phone: undefined });
    expect(place("ftp://files.example", "+12")).toMatchObject({ website: undefined, phone: undefined });
    expect(place("not a url", null)).toMatchObject({ website: undefined, phone: undefined });
  });

  it("keeps a brand's style sentence, traits and price range, but not who it targets", () => {
    const compact = compactEntity({
      name: "Suta",
      entity_id: "B1",
      subtype: "urn:entity:brand",
      properties: {
        style_description: "Traditional Indian silhouettes with clean, modern lines.",
        aesthetic_properties: ["Earthy Tones", "Textured Fabrics", null, "Hand-Finished Details"],
        price_range_usd_min: 20,
        price_range_usd_max: 150,
        target_income_level: ["Middle Income"],
        audience_identity: ["Urban Women"],
      },
    });
    expect(compact.brand).toEqual({
      style: "Traditional Indian silhouettes with clean, modern lines.",
      traits: ["Earthy Tones", "Textured Fabrics", "Hand-Finished Details"],
      price: { min: 20, max: 150 },
    });
    expect(JSON.stringify(compact)).not.toMatch(/Income|Urban Women/);
    expect(compactEntity({ name: "Plain", entity_id: "B2", subtype: "urn:entity:brand", properties: {} }).brand).toBeUndefined();
  });

  it("keeps an artist's notable songs, genres and lyrical themes, without themes that say who people are", () => {
    const compact = compactEntity({
      name: "Phoebe Bridgers",
      entity_id: "A1",
      subtype: "urn:entity:artist",
      properties: {
        notable_songs: ["Motion Sickness", "Kyoto", "Garden Song", "I Know The End", "Scott Street"],
        primary_genres: ["Indie Rock", "Indie Folk"],
        lyrical_themes: ["Heartbreak", "Mental Health", "Memory", "Nostalgia"],
      },
    });
    expect(compact.artist).toEqual({
      songs: ["Motion Sickness", "Kyoto", "Garden Song", "I Know The End"],
      genres: ["Indie Rock", "Indie Folk"],
      themes: ["Heartbreak", "Memory", "Nostalgia"],
    });
  });

  it("keeps nothing personal about a person", () => {
    const compact = compactEntity({
      name: "Tripti Dimri",
      entity_id: "H1",
      subtype: "urn:entity:person",
      properties: {
        date_of_birth: "1994-02-23",
        gender: ["female"],
        citizenship: ["India"],
        image: { url: "https://images.qloo.com/i/h1.jpg" },
      },
    });
    expect(compact).toMatchObject({ kind: "person", image: "https://images.qloo.com/i/h1.jpg" });
    expect(JSON.stringify(compact)).not.toMatch(/1994|female|citizenship/);
  });
});
