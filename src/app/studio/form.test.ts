import { describe, expect, it } from "vitest";
import { EMPTY_FORM, addFilm, exampleChip, formFromBrief, looksLikeImport, removeFilm, toBrief, validateForm } from "./form";

describe("the brief by format", () => {
  const inMumbai = { ...EMPTY_FORM, city: "Mumbai" };

  it("starts a music video from its artist and a short film from the films it's after", () => {
    expect(validateForm({ ...inMumbai, artist: "Prateek Kuhad" })).toBeNull();
    expect(validateForm({ ...inMumbai, format: "short_film", artist: "Prateek Kuhad" })).toMatchObject({ field: "touchstones" });
    expect(validateForm({ ...inMumbai, format: "short_film", touchstones: "Past Lives" })).toBeNull();
    expect(validateForm({ ...inMumbai, artist: "Chaar Diwaari", standIns: "A\nB\nC\nD" })).toMatchObject({ field: "standIns" });
  });

  it("sends stand-ins only for a music video's artist, and fills them back in", () => {
    const form = { ...inMumbai, artist: "Chaar Diwaari", standIns: "Seedhe Maut\nPrabh Deep" };
    expect(toBrief(form).stand_ins).toEqual(["Seedhe Maut", "Prabh Deep"]);
    expect(toBrief({ ...form, format: "short_film", touchstones: "Past Lives" }).stand_ins).toEqual([]);
    expect(toBrief({ ...form, artist: "" }).stand_ins).toEqual([]);
    expect(formFromBrief(toBrief(form)).standIns).toBe("Seedhe Maut\nPrabh Deep");
  });
});

describe("the brief's taste field", () => {
  it("tells an import link from a film title", () => {
    expect(looksLikeImport("https://www.themoviedb.org/list/28")).toBe(true);
    expect(looksLikeImport("https://www.imdb.com/title/tt0118694/")).toBe(true);
    expect(looksLikeImport("tt0118694")).toBe(true);
    expect(looksLikeImport("In the Mood for Love")).toBe(false);
    expect(looksLikeImport("Paris, Texas")).toBe(false);
  });

  it("adds a typed film once, whatever its spacing or case, and removes it again", () => {
    const one = addFilm(EMPTY_FORM, "In the Mood for Love");
    expect(one.directorFilms).toBe("In the Mood for Love");
    expect(addFilm(one, "  in the mood  for love ")).toBe(one);
    const two = addFilm(one, "Rockstar (2011)");
    expect(two.directorFilms).toBe("In the Mood for Love\nRockstar (2011)");
    expect(removeFilm(two, "In the Mood for Love").directorFilms).toBe("Rockstar (2011)");
  });

  it("names an example brief for its chip", () => {
    expect(exampleChip({ artist: "Frank Ocean", touchstones: ["Forgotten"], city: "New York" })).toBe("Frank Ocean, New York");
    expect(exampleChip({ format: "short_film", touchstones: ["In the Mood for Love"], city: "Mumbai" })).toBe(
      "after In the Mood for Love, Mumbai",
    );
  });
});
