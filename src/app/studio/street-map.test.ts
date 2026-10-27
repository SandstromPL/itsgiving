import { describe, expect, it } from "vitest";
import { distanceM } from "@/lib/tools/heatmap";
import { mapFrame } from "./street-map";

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
