import { describe, expect, it } from "vitest";
import type { CompactEntity } from "../qloo";
import { briefSchema, normalizeBrief } from "./brief";
import { writePrompt, writeSchema, type WriteContext } from "./write";

const entity = (id: string, name: string, extra: Partial<CompactEntity> = {}): CompactEntity => ({ id, name, tags: [], ...extra });

function context(overrides: Partial<WriteContext> = {}): WriteContext {
  return {
    brief: normalizeBrief(briefSchema.parse({ artist: "Prateek Kuhad", city: "Mumbai", budget: "indie" })),
    artistNames: ["Prateek Kuhad"],
    touchstoneNames: [],
    directorNames: [],
    direction: "Two people keep almost meeting.",
    tone: [],
    references: [],
    series: [],
    brands: [],
    places: [],
    leans: [],
    names: new Map(),
    ...overrides,
  };
}

describe("writePrompt", () => {
  it("tells the writer a brand's prices and a place's hours and best time of day", () => {
    const prompt = writePrompt(
      context({
        brands: [{ ref: "B1", item: entity("b1", "Suta", { brand: { price: { min: 20, max: 150 } } }) }],
        places: [
          {
            ref: "L1",
            item: entity("p1", "Thalassa", { place: { hours: { monday: "closed", tuesday: "12:00–23:30" }, fits: ["Evening"] } }),
          },
        ],
      }),
    );
    expect(prompt).toContain("B1 Suta · $20–150");
    expect(prompt).toContain("L1 Thalassa · open Tue 12:00–23:30; closed Mon · suits evening");
    expect(prompt).toContain("shoot before it opens or on the day it's closed");
    expect(prompt).not.toContain("rent or match");
  });

  it("says which brands start above the budget, so their looks are references to rent or match", () => {
    const prompt = writePrompt(
      context({
        brands: [
          { ref: "B1", item: entity("b1", "Louis Vuitton", { brand: { price: { min: 300, max: 10000 } } }) },
          { ref: "B2", item: entity("b2", "Suta", { brand: { price: { min: 20, max: 150 } } }) },
        ],
      }),
    );
    expect(prompt).toContain("On an indie budget, Louis Vuitton is a reference to rent or match, not to buy");
  });
});

describe("writeSchema", () => {
  const draft = (references: { ref: string }[], cover: string | null) => ({
    title: "Almost",
    logline: "Two people keep almost meeting.",
    concept: "A concept.",
    beats: [1, 2, 3].map((i) => ({ title: `Beat ${i}`, description: "Something happens.", reference: null })),
    references: references.map((r) => ({ ...r, why: "It fits.", borrow: "Borrow the light." })),
    cover,
    palette: ["#111111", "#222222", "#333333"].map((hex) => ({ name: hex, hex })),
    lighting: ["Soft.", "Low."],
    shots: ["Wide.", "Close.", "Held."],
  });
  const ctx = context({
    references: [
      { ref: "R1", item: entity("f1", "Past Lives") },
      { ref: "R2", item: entity("f2", "Aftersun") },
    ],
    series: [{ ref: "S1", item: entity("s1", "Normal People", { kind: "tv_show" }) }],
  });

  it("lets a reference be a film or a series, but the cover only a film", () => {
    expect(writeSchema(ctx).safeParse(draft([{ ref: "R1" }, { ref: "S1" }], "R1")).success).toBe(true);
    expect(writeSchema(ctx).safeParse(draft([{ ref: "R1" }, { ref: "S1" }], "S1")).success).toBe(false);
    expect(writeSchema(ctx).safeParse(draft([{ ref: "R1" }, { ref: "S9" }], "R1")).success).toBe(false);
  });

  it("lists the series apart from the films in the prompt", () => {
    expect(writePrompt(ctx)).toMatch(/Film references:\nR1 Past Lives\nR2 Aftersun\nSeries:\nS1 Normal People/);
  });
});
