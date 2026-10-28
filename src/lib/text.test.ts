import { describe, expect, it } from "vitest";
import { afterLabel, withYear, withoutIdentity } from "./text";

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

describe("afterLabel", () => {
  it("drops the label's word when the note opens with it, so the line doesn't repeat it", () => {
    expect(afterLabel("Borrow", "Borrow the slow push-ins for the chorus.")).toBe("the slow push-ins for the chorus.");
    expect(afterLabel("Borrow", "Borrowing its sodium light: shoot the bridge at dusk.")).toBe(
      "its sodium light: shoot the bridge at dusk.",
    );
    expect(afterLabel("Borrow", "borrow: the hand-held drift.")).toBe("the hand-held drift.");
  });

  it("leaves any other note as it is", () => {
    expect(afterLabel("Borrow", "Shoot the chorus in one take.")).toBe("Shoot the chorus in one take.");
    expect(afterLabel("Borrow", "Borrowed light from shop signs.")).toBe("Borrowed light from shop signs.");
    expect(afterLabel("Borrow", "Borrow")).toBe("Borrow");
  });
});
