import { describe, expect, it } from "vitest";
import { darkHex, darkOf, mixHex } from "./color";

describe("palette colours", () => {
  const palette = ["#e8d5b0", "#1f3a4d", "#c0392b"];

  it("mixes the darkest colour toward ink, as CSS for pages and as hex for the share card", () => {
    expect(darkOf(palette)).toBe("color-mix(in srgb, #1f3a4d 55%, #121211)");
    expect(darkHex(palette)).toBe(mixHex("#1f3a4d", "#121211", 0.55));
  });

  it("skips malformed colours, and falls back when none is left", () => {
    expect(darkOf(["#fff", "nope"])).toBe("#121211");
    expect(darkHex([])).toBe("#2a2926");
  });

  it("mixes channel by channel", () => {
    expect(mixHex("#ffffff", "#000000", 0.5)).toBe("#808080");
  });
});
