import { describe, expect, it } from "vitest";
import { createQlooClient } from "../qloo";
import { mockEntityId } from "../qloo/mock/catalog";
import { TOOLS, runTool, toolDefinitions } from "./registry";
import type { CompactEntity } from "../qloo";

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

  it("uses the year to pick between same-name titles", async () => {
    const result = await runTool("resolve_entities", { items: [{ name: "Forgotten", type: "movie", year: 2017 }] }, ctx);
    expect(result.status).toBe("ok");
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

describe("scout_locations", () => {
  it("keeps places in the city that have photos and the required ambience", async () => {
    const result = await runTool(
      "scout_locations",
      { city: "Bombay", ambience_tag_ids: ["urn:tag:ambience:qloo:lively"] },
      ctx,
    );
    const names = (result.data as Data<"locations">).locations.map((l) => l.name);
    expect(names).toContain("Leopold Cafe");
    expect(names).not.toContain("Bonobo"); // lively, but has no photo
    expect(names).not.toContain("Balthazar"); // New York
  });

  it("suggests how to relax the search when nothing matches", async () => {
    const result = await runTool(
      "scout_locations",
      { city: "Mumbai", ambience_tag_ids: ["urn:tag:setting:qloo:waterfront"], price_level_max: 1 },
      ctx,
    );
    expect(result.status).toBe("empty");
    expect(result.summary).toContain("tag_mode=bias");
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
