import { describe, expect, it } from "vitest";
import { aboveBudget, budgetPhrase, openingLine, priceLine, siteName } from "./options";

describe("priceLine", () => {
  it("reads a brand's price range in US dollars", () => {
    expect(priceLine({ min: 20, max: 150 })).toBe("$20–150");
    expect(priceLine({ min: 300, max: 10000 })).toBe("$300–10,000");
    expect(priceLine({ min: 45, max: 45 })).toBe("$45");
    expect(priceLine({ min: 300 })).toBe("from $300");
    expect(priceLine({ max: 90 })).toBe("up to $90");
    expect(priceLine(undefined)).toBeUndefined();
  });
});

describe("aboveBudget", () => {
  const brand = (min?: number) => ({ brand: { price: { min, max: 500 } } });
  it("marks a brand whose pieces start at or above what the budget buys", () => {
    expect(aboveBudget(brand(150), "indie")).toBe(true);
    expect(aboveBudget(brand(149), "indie")).toBe(false);
    expect(aboveBudget(brand(75), "shoestring")).toBe(true);
    expect(aboveBudget(brand(5000), "premium")).toBe(false);
    expect(aboveBudget({}, "indie")).toBe(false);
  });
});

describe("budgetPhrase", () => {
  it("reads a budget with the right article", () => {
    expect(budgetPhrase("indie")).toBe("an indie budget");
    expect(budgetPhrase("shoestring")).toBe("a shoestring budget");
  });
});

describe("openingLine", () => {
  it("runs days with the same hours together and ends on the days it's closed", () => {
    expect(
      openingLine({
        monday: "closed",
        tuesday: "18:00–01:30",
        wednesday: "18:00–01:30",
        thursday: "18:00–01:30",
        friday: "18:00–02:30",
        saturday: "18:00–02:30",
        sunday: "18:00–01:30",
      }),
    ).toBe("Tue–Thu 18:00–01:30; Fri–Sat 18:00–02:30; Sun 18:00–01:30; closed Mon");
  });

  it("says daily when every day is the same, and leaves out days Qloo doesn't list", () => {
    const every = Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, "08:00–22:00"]),
    );
    expect(openingLine(every)).toBe("daily 08:00–22:00");
    expect(openingLine(Object.fromEntries(Object.keys(every).map((d) => [d, "24 hours"])))).toBe("24 hours, every day");
    expect(openingLine(Object.fromEntries(Object.keys(every).map((d) => [d, "closed"])))).toBeUndefined();
    expect(openingLine(Object.fromEntries(Object.keys(every).map((d) => [d, "00:00–00:00"])))).toBe("24 hours, every day");
    expect(openingLine({ monday: "10:00–20:00", wednesday: "10:00–20:00" })).toBe("Mon 10:00–20:00; Wed 10:00–20:00");
    expect(openingLine(undefined)).toBeUndefined();
  });
});

describe("siteName", () => {
  it("reads a website as its name", () => {
    expect(siteName("https://www.thalassa.in/menu")).toBe("thalassa.in");
    expect(siteName("http://jeffgoldbergstudio.com/")).toBe("jeffgoldbergstudio.com");
  });
});
