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

  it("opens a board handed over whole: a saved treatment's rework, or Save coming back from sign-in", () => {
    const treatment = { id: "k1", title: "Almost, in Bandra", brief: { city: "Mumbai" }, references: [] };
    expect(parseHandoff(stored({ board: { treatment, nudge: "darker" } }), "")).toMatchObject({
      kind: "board",
      treatment: { title: "Almost, in Bandra" },
      nudge: "darker",
      save: false,
      seal: undefined,
    });
    const now = Date.parse("2026-10-27T10:00:00Z");
    expect(
      parseHandoff(stored({ board: { treatment, seal: "s3al", save: true, nudge: "louder", at: now - 60_000 } }), "", now),
    ).toMatchObject({
      kind: "board",
      seal: "s3al",
      save: true,
      nudge: undefined,
    });
    // An abandoned sign-in's board still opens later, but no longer saves itself.
    expect(parseHandoff(stored({ board: { treatment, save: true, at: now - 16 * 60_000 } }), "", now)).toMatchObject({ save: false });
    expect(parseHandoff(stored({ board: { treatment, save: true } }), "", now)).toMatchObject({ save: false });
    // Not a treatment: nothing opens (the server would refuse to save it anyway).
    expect(parseHandoff(stored({ board: { treatment: { title: "x" } } }), "")).toBeNull();
    expect(parseHandoff(stored({ board: { treatment: "<b>hi</b>", save: true } }), "")).toBeNull();
  });

  it("hands off featured examples only, and shrugs off junk", () => {
    expect(parseHandoff(stored({ from: "frank-ocean-forgotten" }), "")).toBeNull();
    expect(parseHandoff(null, "?fill=nope")).toBeNull();
    expect(parseHandoff("{ not json", "")).toBeNull();
    expect(parseHandoff(null, "")).toBeNull();
  });
});
