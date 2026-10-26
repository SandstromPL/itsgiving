import { describe, expect, it } from "vitest";
import { parseHandoff } from "./handoff";

const stored = (value: object) => JSON.stringify(value);

describe("parseHandoff", () => {
  it("opens a featured example from storage, with the rework its chip asked for", () => {
    expect(parseHandoff(stored({ from: "prateek-kuhad-mumbai", nudge: "darker" }), "")).toMatchObject({
      example: { slug: "prateek-kuhad-mumbai" },
      open: true,
      nudge: "darker",
    });
    expect(parseHandoff(stored({ from: "charli-xcx-new-york", nudge: "louder" }), "")).toMatchObject({ open: true, nudge: undefined });
  });

  it("only fills a brief named in the URL, and never runs it", () => {
    const filled = parseHandoff(null, "?fill=charli-xcx-new-york&nudge=darker");
    expect(filled).toMatchObject({ example: { slug: "charli-xcx-new-york" }, open: false });
    expect(filled?.nudge).toBeUndefined();
    // A link can't open (run) anything: only storage, which only a featured page's chip writes, does.
    expect(parseHandoff(null, "?from=charli-xcx-new-york")).toBeNull();
  });

  it("hands off featured examples only, and shrugs off junk", () => {
    expect(parseHandoff(stored({ from: "frank-ocean-forgotten" }), "")).toBeNull();
    expect(parseHandoff(null, "?fill=nope")).toBeNull();
    expect(parseHandoff("{ not json", "")).toBeNull();
    expect(parseHandoff(null, "")).toBeNull();
  });
});
