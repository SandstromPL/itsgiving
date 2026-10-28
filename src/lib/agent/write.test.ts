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
    characters: [],
    casting: [],
    roles: new Map(),
    music: [],
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
    characters: [],
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

  it("lists each title's archetypes, traits and characters, and the parts each actor is known for", () => {
    const fingernails = entity("f3", "Fingernails", {
      year: 2023,
      film: { archetypes: ["The triangle", "The lover"], traits: ["Conflicted"] },
    });
    const mescal = entity("h1", "Paul Mescal", { kind: "person" });
    const prompt = writePrompt({
      ...ctx,
      references: [...ctx.references, { ref: "R3", item: fingernails }],
      characters: [
        { ref: "C1", item: { title: fingernails, name: "Anna", actor: "Jessie Buckley" } },
        { ref: "C2", item: { title: fingernails, name: "Amir", actor: "Riz Ahmed" } },
      ],
      casting: [
        { ref: "P1", item: mescal },
        { ref: "P2", item: entity("h2", "Tripti Dimri", { kind: "person" }) },
      ],
      roles: new Map([["h1", [{ character: "Calum", title: "Aftersun", year: 2022 }]]]),
    });
    expect(prompt).toContain(
      "R3 Fingernails (2023) · archetypes: The triangle, The lover · traits: Conflicted · characters: C1 Anna (Jessie Buckley), C2 Amir (Riz Ahmed)\n",
    );
    expect(prompt).toContain("Actors (faces this audience knows):\nP1 Paul Mescal · known as Calum in Aftersun (2022)\nP2 Tripti Dimri\n");
    expect(prompt).toContain("never an actor's looks or life");
    expect(prompt).toContain("never from who the audience is");
    // In a music video the artist is themselves, not one of the story's people.
    expect(prompt).toContain("the artist plays themselves");
    expect(writePrompt({ ...ctx, brief: { ...ctx.brief, format: "short_film" } })).not.toContain("the artist plays themselves");
  });

  it("cites a character's source and face only by the refs listed, and needs no repair without them", () => {
    const withPeople = {
      ...ctx,
      characters: [{ ref: "C1", item: { title: ctx.references[0].item, name: "Nora", actor: "Greta Lee" } }],
      casting: [{ ref: "P1", item: entity("h1", "Tripti Dimri", { kind: "person" }) }],
    };
    const rest = draft([{ ref: "R1" }, { ref: "R2" }], "R1");
    const person = { name: "Ira", who: "w", wants: "w", hides: "h", presence: "p", look: "l", arc: "a", beats: [1, 3] };
    const parse = (c: WriteContext, extra: object) => writeSchema(c).safeParse({ ...rest, characters: [{ ...person, ...extra }] }).success;
    expect(parse(withPeople, { from: "C1", take: "Her stillness.", face: "P1" })).toBe(true);
    expect(parse(withPeople, { from: null, take: "", face: null })).toBe(true);
    expect(parse(withPeople, { from: "C2", take: "", face: null })).toBe(false);
    expect(parse(withPeople, { from: null, take: "", face: "P2" })).toBe(false);
    // With nothing listed, a source or a face can only be null.
    expect(parse(ctx, { from: null, take: "", face: null })).toBe(true);
    expect(parse(ctx, { from: "C1", take: "", face: null })).toBe(false);
    expect(writeSchema(withPeople).safeParse({ ...rest, characters: [] }).success).toBe(true);
  });

  it("lists a short film's artists with their genres and songs, and lets a song be left out", () => {
    const phoebe = entity("a1", "Phoebe Bridgers", {
      kind: "artist",
      artist: { genres: ["Indie Rock", "Indie Folk"], songs: ["Motion Sickness", "Kyoto", "Garden Song", "Punisher"] },
    });
    const withMusic = { ...ctx, music: [{ ref: "M1", item: phoebe }] };
    expect(writePrompt(withMusic)).toContain("M1 Phoebe Bridgers · Indie Rock, Indie Folk · songs: Motion Sickness, Kyoto, Garden Song\n");
    expect(writePrompt(withMusic)).toContain("Name a\nsong only from that artist's listed songs");
    const rest = draft([{ ref: "R1" }, { ref: "R2" }], "R1");
    expect(writeSchema(withMusic).safeParse({ ...rest, music: [{ ref: "M1", song: null, use: "Under the opening." }] }).success).toBe(true);
    expect(writeSchema(withMusic).safeParse({ ...rest, music: [{ ref: "M1", song: "Kyoto", use: "At the turn." }] }).success).toBe(true);
  });

  it("lists the series apart from the films in the prompt", () => {
    expect(writePrompt(ctx)).toMatch(/Film references:\nR1 Past Lives\nR2 Aftersun\nSeries:\nS1 Normal People/);
  });
});
