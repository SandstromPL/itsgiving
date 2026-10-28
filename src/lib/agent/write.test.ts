import { describe, expect, it } from "vitest";
import type { CompactEntity } from "../qloo";
import { briefSchema, normalizeBrief } from "./brief";
import { writePrompt, type WriteContext } from "./write";

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
