import { describe, expect, it } from "vitest";
import { QlooClient, createQlooClient } from "../qloo";
import { createMockFetch } from "../qloo/mock/server";
import { mockEntityId } from "../qloo/mock/catalog";
import { distanceM, heatGrid, hotAreas, type HeatArea, type HeatGrid } from "./heatmap";
import { TOOLS, runTool, toolDefinitions } from "./registry";
import { oneBranchEach } from "./treatment";
import type { CompactEntity, HeatCell } from "../qloo";

const qloo = createQlooClient({ mode: "mock", baseUrl: "https://mock.qloo.invalid" });
const ctx = { qloo };

type Data<K extends string> = Record<K, CompactEntity[]>;

describe("tool definitions", () => {
  it("export strict JSON Schemas with snake_case names", () => {
    const defs = toolDefinitions();
    expect(defs).toHaveLength(TOOLS.length);
    for (const def of defs) {
      expect(def.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(def.description.length).toBeGreaterThan(80);
      expect(def.input_schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(def.input_schema).not.toHaveProperty("$schema");
    }
  });

  it.each(TOOLS.map((tool) => [tool.name, tool] as const))("%s example runs against the mock", async (name, tool) => {
    const result = await runTool(name, tool.example, ctx);
    expect(result.error).toBeUndefined();
    expect(["ok", "needs_input"]).toContain(result.status);
    expect(result.provenance.length).toBeGreaterThan(0);
    expect(result.provenance.every((p) => p.mode === "mock")).toBe(true);
  });
});

describe("resolve_entities", () => {
  it("resolves exact names and asks about ambiguous ones", async () => {
    const result = await runTool(
      "resolve_entities",
      { items: [{ name: "prateek kuhad", type: "artist" }, { name: "Forgotten", type: "movie" }] },
      ctx,
    );
    expect(result.status).toBe("needs_input");
    const [artist, film] = (result.data as { items: { status: string; candidates?: CompactEntity[] }[] }).items;
    expect(artist.status).toBe("resolved");
    expect(film.status).toBe("ambiguous");
    expect(film.candidates?.map((c) => c.year).sort()).toEqual([2004, 2017]);
  });

  it("takes a far better-known exact match without asking, and keeps close calls for the user", async () => {
    // Mock: "Forgotten" (popularity 0.62) vs "The Forgotten" (0.58) is a close call...
    const close = await runTool("resolve_entities", { items: [{ name: "Forgotten", type: "movie" }] }, ctx);
    expect(close.status).toBe("needs_input");
    // ...while a search that returns one dominant title among same-name matches resolves, and says how many it beat.
    const mock = createMockFetch();
    const dominant = new QlooClient({
      mode: "mock",
      baseUrl: "https://mock.qloo.invalid",
      fetch: async (url, init) => {
        if (!url.includes("/search")) return mock(url, init);
        const film = (id: string, popularity: number) => ({ entity_id: id, name: "Aftersun", subtype: "urn:entity:movie", popularity, properties: { release_year: 2022 } });
        return new Response(JSON.stringify({ results: [film("A", 0.999), film("B", 0.086)] }), { status: 200 });
      },
    });
    const result = await runTool("resolve_entities", { items: [{ name: "Aftersun", type: "movie", year: 2022 }] }, { qloo: dominant });
    const [item] = (result.data as { items: { status: string; match?: CompactEntity; among?: number }[] }).items;
    expect(item).toMatchObject({ status: "resolved", match: { id: "A" }, among: 2 });
  });

  it("uses the year to pick between same-name titles", async () => {
    const result = await runTool("resolve_entities", { items: [{ name: "Forgotten", type: "movie", year: 2017 }] }, ctx);
    expect(result.status).toBe("ok");
  });

  it("never asks about a city, and reads a state that shares a city's name as the city", async () => {
    const result = await runTool(
      "resolve_entities",
      { items: [{ name: "New York", type: "locality" }, { name: "Bombay", type: "locality" }] },
      ctx,
    );
    expect(result.status).toBe("ok");
    const [newYork, mumbai] = (result.data as { items: { status: string; match?: CompactEntity; note?: string }[] }).items;
    // Like live Qloo, the mock lists New York State first.
    expect(newYork.match?.disambiguation).toBe("New York, New York, United States of America");
    expect(newYork.note).toContain("is the state");
    expect(mumbai).toMatchObject({ status: "resolved", match: { name: "Mumbai" } });
    expect(mumbai.note).toBeUndefined();
  });
});

describe("audience_heatmap", () => {
  const cell = (lat: number, lon: number, affinity: number, popularity = 1): HeatCell => ({ lat, lon, precision: 7, affinity, popularity });

  it("groups the hottest tiles into areas, strongest first, with heat-weighted centres", () => {
    const tiles = [
      // A dense, hot cluster in South Mumbai, a weaker one in Bandra (8 km north), and cold tiles between.
      ...[0, 0.002, 0.004].map((d) => cell(18.93 + d, 72.83, 0.9)),
      ...[0, 0.002].map((d) => cell(19.06 + d, 72.83, 0.6)),
      ...Array.from({ length: 40 }, (_, i) => cell(18.95 + i * 0.002, 72.85, 0.01)),
    ];
    const areas = hotAreas(tiles, 3, 2_000);
    expect(areas.map((a) => a.rank)).toEqual([1, 2, 3]);
    expect(areas[0].lat).toBeCloseTo(18.932, 3);
    expect(areas[1].lat).toBeCloseTo(19.061, 3);
    expect(areas[0].share).toBeGreaterThan(areas[1].share);
    expect(areas.reduce((sum, a) => sum + a.share, 0)).toBeLessThanOrEqual(1.0001);
    expect(distanceM(areas[0], areas[1])).toBeGreaterThan(2_000);
  });

  it("bins thousands of tiles into a small grid that keeps each square's hottest tile", () => {
    const tiles = Array.from({ length: 2_000 }, (_, i) => cell(18.9 + (i % 50) * 0.004, 72.8 + Math.floor(i / 50) * 0.002, (i % 7) / 7));
    const grid = heatGrid(tiles, [], 20) as HeatGrid;
    expect(grid.tiles.length).toBeLessThan(500);
    expect(Math.max(...grid.tiles.map((t) => t.heat))).toBe(1);
    expect(grid.tiles.every((t) => t.heat >= 0 && t.heat <= 1)).toBe(true);
    // Squares are square on the ground: wider in degrees of longitude away from the equator.
    expect(grid.cell.lon).toBeGreaterThan(grid.cell.lat);
    expect(heatGrid([])).toBeUndefined();
  });

  it("frames the map on the strongest areas, never thinner than 4:5 and never finer than Qloo's tiles", () => {
    // A long, thin city: 0.4 degrees of latitude, 0.05 of longitude, in New York-sized tiles (geohash 6).
    const tiles = Array.from({ length: 800 }, (_, i) => ({ ...cell(18.9 + (i % 80) * 0.005, 72.8 + Math.floor(i / 80) * 0.005, 0.5), precision: 6 }));
    const grid = heatGrid(tiles, [{ lat: 19.0, lon: 72.82, radius_m: 2_000 }]) as HeatGrid;
    const { south, north, west, east } = grid.bounds!;
    const kx = Math.cos((19 * Math.PI) / 180);
    // 2 km ring plus 1.5 km margin either side, at least 6 km: about 7 km each way, centred on the area.
    expect((north - south) * 111.32).toBeCloseTo(7, 0);
    expect((east - west) * kx * 111.32).toBeCloseTo(7, 0);
    expect(grid.tiles.every((t) => t.lat >= south && t.lat <= north && t.lon >= west && t.lon <= east)).toBe(true);
    // A geohash-6 tile is 360/2^15 degrees of longitude wide: the squares are at least that wide.
    expect(grid.cell.lon).toBeGreaterThanOrEqual(360 / 2 ** 15 - 1e-6);
  });

  it("names the strongest areas of a city after their neighbourhoods", async () => {
    const result = await runTool("audience_heatmap", { signal_entity_ids: [mockEntityId("Charli xcx")], city: "New York" }, ctx);
    expect(result.status).toBe("ok");
    const { areas, map } = result.data as { areas: HeatArea[]; map: HeatGrid };
    expect(areas.length).toBeGreaterThan(0);
    expect(areas[0]).toMatchObject({ rank: 1, radius_m: 2_000, district: expect.any(String) });
    expect(areas.every((a) => a.name && a.name !== "New York")).toBe(true);
    expect(map.tiles.length).toBeGreaterThan(20);
    // One heatmap call, then one neighbourhood lookup per area.
    expect(result.provenance.map((p) => p.path)).toEqual(["/v2/insights", ...areas.map(() => "/search")]);
  });
});

describe("reference_films", () => {
  it("returns different references for different artists", async () => {
    const run = async (artist: string) => {
      const result = await runTool("reference_films", { signal_entity_ids: [mockEntityId(artist)], take: 5 }, ctx);
      return (result.data as Data<"references">).references.map((r) => r.name);
    };
    const folk = await run("Prateek Kuhad");
    const hyperpop = await run("Charli xcx");
    expect(folk).not.toEqual(hyperpop);
  });

  it("applies the popularity ceiling and explains each pick", async () => {
    const result = await runTool(
      "reference_films",
      { signal_entity_ids: [mockEntityId("Frank Ocean")], max_popularity: 0.85 },
      ctx,
    );
    const references = (result.data as Data<"references">).references;
    expect(references.length).toBeGreaterThan(0);
    expect(references.every((r) => (r.popularity ?? 1) <= 0.85)).toBe(true);
    expect(references[0].because?.[0]?.entity_id).toBe(mockEntityId("Frank Ocean"));
  });
});

describe("styling_brands", () => {
  it("keeps to fashion brands and skips explainability when style tags steer the ranking", async () => {
    const plain = await runTool("styling_brands", { signal_entity_ids: [mockEntityId("Charli xcx")] }, ctx);
    expect(plain.provenance[0].query).toMatchObject({ "filter.tags": "urn:tag:genre:brand:fashion", "feature.explainability": "true" });
    const steered = await runTool(
      "styling_brands",
      { signal_entity_ids: [mockEntityId("Charli xcx")], style_tag_ids: ["urn:tag:genre:brand:fashion:streetwear"] },
      ctx,
    );
    expect(steered.provenance[0].query).toMatchObject({ "feature.explainability": "false", "signal.interests.tags": "urn:tag:genre:brand:fashion:streetwear" });
    expect((steered.data as Data<"brands">).brands[0].name).toMatch(/Stüssy|Carhartt WIP/);
  });
});

describe("oneBranchEach", () => {
  it("keeps the best-ranked branch of each chain, in Qloo's order", () => {
    const places = ["Starbucks - Juhu Tara Road", "Cafe Mondegar", "Starbucks - Vile Parle West", "The Coffee Bean & Tea Leaf (Malad)", "The Coffee Bean & Tea Leaf - Bandra"];
    expect(oneBranchEach(places.map((name) => ({ name }))).map((p) => p.name)).toEqual([
      "Starbucks - Juhu Tara Road",
      "Cafe Mondegar",
      "The Coffee Bean & Tea Leaf (Malad)",
    ]);
  });
});

describe("scout_locations", () => {
  it("keeps the asked-for kinds of venue in the city, with photos, ranked by ambience", async () => {
    const result = await runTool(
      "scout_locations",
      { city: "Bombay", venue_kinds: ["bar"], ambience_tag_ids: ["urn:tag:ambience:qloo:lively"] },
      ctx,
    );
    const names = (result.data as Data<"locations">).locations.map((l) => l.name);
    expect(names).toContain("Leopold Cafe"); // restaurant and bar
    expect(names).not.toContain("Prithvi Cafe"); // a cafe, not a bar
    expect(names).not.toContain("Bonobo"); // a bar, but has no photo
    expect(names).not.toContain("Balthazar"); // New York
    expect(result.provenance[0].query["filter.tags"]).toContain("urn:tag:genre:place:restaurant:bar");
    expect(result.provenance[0].query["signal.interests.tags"]).toBe("urn:tag:ambience:qloo:lively");
  });

  it("keeps to the area around a point when given one", async () => {
    // Lower Parel: The Bombay Canteen is there, Juhu's Prithvi Cafe is 12 km away.
    const near = { lat: 18.9965, lon: 72.8251, radius_m: 2_000 };
    const result = await runTool("scout_locations", { city: "Mumbai", near, signal_entity_ids: [mockEntityId("Prateek Kuhad")] }, ctx);
    const locations = (result.data as Data<"locations">).locations;
    expect(locations.map((l) => l.name)).toContain("The Bombay Canteen");
    expect(locations.every((l) => distanceM(near, { lat: l.place!.lat!, lon: l.place!.lon! }) <= 2_000)).toBe(true);
    expect(result.provenance[0].query).toMatchObject({ "filter.location": "POINT(72.8251 18.9965)", "filter.location.radius": "2000" });
    expect(result.provenance[0].query).not.toHaveProperty("filter.location.query");
  });

  it("suggests how to relax the search when nothing matches", async () => {
    const result = await runTool(
      "scout_locations",
      { city: "Mumbai", venue_kinds: ["music_venue"], price_level_max: 1 },
      ctx,
    );
    expect(result.status).toBe("empty");
    expect(result.summary).toContain("more venue_kinds");
  });
});

describe("runTool errors", () => {
  it("rejects invalid input without calling Qloo", async () => {
    const result = await runTool("find_tags", { query: "" }, ctx);
    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("invalid_input");
    expect(result.provenance).toHaveLength(0);
  });

  it("reports an unknown tool", async () => {
    expect((await runTool("nope", {}, ctx)).error?.kind).toBe("unknown_tool");
  });

  it("wraps Qloo failures (unresolvable city) as a tool error", async () => {
    const result = await runTool("scout_locations", { city: "Atlantis" }, ctx);
    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("bad_request");
    expect(result.provenance).toHaveLength(0);
  });
});
