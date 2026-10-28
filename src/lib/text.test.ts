import { describe, expect, it } from "vitest";
import { withYear, withoutIdentity } from "./text";

describe("withYear", () => {
  it("names a film with its year, or bare when the year is unknown", () => {
    expect(withYear("Drive", 2011)).toBe("Drive (2011)");
    expect(withYear("Drive")).toBe("Drive");
    expect(withYear("Drive", null)).toBe("Drive");
  });
});

describe("withoutIdentity", () => {
  it("drops tags that name who people are and keeps the rest in order", () => {
    const tags = [{ name: "Melancholy" }, { name: "LGBT" }, { name: "Neo-Noir" }, { name: "Christian" }];
    expect(withoutIdentity(tags).map((t) => t.name)).toEqual(["Melancholy", "Neo-Noir"]);
  });

  it("reads the name through an accessor when it isn't the item's own", () => {
    const tone = [{ tag: { name: "Queer cinema" } }, { tag: { name: "Dreamy" } }];
    expect(withoutIdentity(tone, (t) => t.tag.name)).toEqual([{ tag: { name: "Dreamy" } }]);
  });
});
