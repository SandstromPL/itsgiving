import { describe, expect, it } from "vitest";
import { distanceM } from "@/lib/tools/heatmap";
import { mapFrame, widen } from "./street-map";

// Roughly Mumbai's heatmap frame: a tall, narrow city.
const MUMBAI = { south: 18.89, west: 72.77, north: 19.27, east: 72.99 };

describe("mapFrame", () => {
  it("puts the bounds' corners on the frame's corners, the longer side at the size asked for", () => {
    const f = mapFrame(MUMBAI);
    expect(f.height).toBeCloseTo(600, 1);
    expect(f.width).toBeLessThan(f.height);
    expect(f.x(MUMBAI.west)).toBeCloseTo(0, 1);
    expect(f.y(MUMBAI.north)).toBeCloseTo(0, 1);
    expect(f.x(MUMBAI.east)).toBeCloseTo(f.width, 1);
    expect(f.y(MUMBAI.south)).toBeCloseTo(f.height, 1);
  });

  it("picks the lowest zoom whose tiles span the frame without stretching", () => {
    const f = mapFrame(MUMBAI, 600, 560);
    const long = Math.max(f.world.width, f.world.height);
    expect(long).toBeGreaterThanOrEqual(560);
    expect(long / 2).toBeLessThan(560);
  });

  it("measures ground distances in frame units, so a 2 km ring is drawn at its true size", () => {
    const f = mapFrame(MUMBAI);
    const mid = (MUMBAI.south + MUMBAI.north) / 2;
    const across = distanceM({ lat: mid, lon: MUMBAI.west }, { lat: mid, lon: MUMBAI.east });
    expect(f.metres(across, mid) / (f.x(MUMBAI.east) - f.x(MUMBAI.west))).toBeCloseTo(1, 2);
  });

  it("prints rounded numbers, so the server and the browser agree", () => {
    const f = mapFrame(MUMBAI);
    for (const value of [f.x(72.8311), f.y(19.0596), f.metres(2_000, 19.06), f.width]) {
      expect(Math.round(value * 100) / 100).toBe(value);
    }
  });
});

describe("widen", () => {
  const aspect = (b: typeof MUMBAI) => {
    const f = mapFrame(b);
    return f.width / f.height;
  };
  const inside = (outer: typeof MUMBAI, inner: typeof MUMBAI) =>
    outer.south <= inner.south + 1e-9 &&
    outer.north >= inner.north - 1e-9 &&
    outer.west <= inner.west + 1e-9 &&
    outer.east >= inner.east - 1e-9;

  it("grows a tall frame sideways to fill a wider box, keeping its height and centre", () => {
    const wide = widen(MUMBAI, 1.05);
    expect(aspect(wide)).toBeCloseTo(1.05, 3);
    expect(wide.south).toBeCloseTo(MUMBAI.south, 9);
    expect(wide.north).toBeCloseTo(MUMBAI.north, 9);
    expect((wide.west + wide.east) / 2).toBeCloseTo((MUMBAI.west + MUMBAI.east) / 2, 9);
    expect(inside(wide, MUMBAI)).toBe(true);
  });

  it("grows a frame taller to fill a taller box, keeping its width", () => {
    const square = { south: 19.0, west: 72.8, north: 19.1, east: 72.9 };
    const tall = widen(square, 0.7);
    expect(aspect(tall)).toBeCloseTo(0.7, 3);
    expect(tall.west).toBeCloseTo(square.west, 9);
    expect(tall.east).toBeCloseTo(square.east, 9);
    expect(inside(tall, square)).toBe(true);
  });

  it("stops at the limit given, but never cuts into the frame itself", () => {
    const limit = { south: 18.8, west: 72.74, north: 19.36, east: 73.02 };
    const grown = widen(MUMBAI, 1.4, limit);
    expect(grown.west).toBe(limit.west);
    expect(grown.east).toBe(limit.east);
    expect(grown.south).toBeCloseTo(MUMBAI.south, 9);
    // A limit inside the frame (a pin outside the grid) leaves the frame as it was on that side.
    const tight = widen(MUMBAI, 1.4, { ...limit, west: 72.8 });
    expect(tight.west).toBe(MUMBAI.west);
  });

  it("leaves a frame that already has the box's shape as it is", () => {
    const same = widen(MUMBAI, aspect(MUMBAI));
    for (const side of ["south", "west", "north", "east"] as const) expect(same[side]).toBeCloseTo(MUMBAI[side], 4);
  });
});
