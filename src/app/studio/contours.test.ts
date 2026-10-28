import { describe, expect, it } from "vitest";
import type { HeatGrid } from "@/lib/tools/heatmap";
import { heatContours } from "./contours";
import { mapFrame, widen } from "./street-map";

const LEVELS = [0.2, 0.4, 0.6, 0.8];

/** A grid of n × n squares near Mumbai, square on the ground like heatGrid's, with heat from `at(row, col)` (row 0 is south). */
function grid(at: (row: number, col: number) => number, n = 20) {
  const cell = { lat: 0.01, lon: 0.01 / Math.cos((19 * Math.PI) / 180) };
  const bounds = { south: 19, west: 72.8, north: 19 + n * cell.lat, east: 72.8 + n * cell.lon };
  const tiles = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const heat = at(row, col);
      if (heat > 0) tiles.push({ lat: bounds.south + (row + 0.5) * cell.lat, lon: bounds.west + (col + 0.5) * cell.lon, heat });
    }
  }
  const map: HeatGrid = { bounds, cell, tiles };
  return { map, frame: mapFrame(bounds) };
}

/** A cone of heat around a square, falling to nothing `reach` squares away. */
const cone =
  (row: number, col: number, reach = 8) =>
  (r: number, c: number) =>
    Math.max(0, 1 - Math.hypot(r - row, c - col) / reach);

/** Path data's separate lines, each as its points and whether it closes. */
function subpaths(d: string) {
  return d
    .split("M")
    .filter(Boolean)
    .map((s) => ({
      closed: s.endsWith("Z"),
      points: s
        .replace("Z", "")
        .split("L")
        .map((p) => p.split(" ").map(Number)),
    }));
}

const box = (points: number[][]) => ({
  left: Math.min(...points.map((p) => p[0])),
  right: Math.max(...points.map((p) => p[0])),
  top: Math.min(...points.map((p) => p[1])),
  bottom: Math.max(...points.map((p) => p[1])),
});

describe("heatContours", () => {
  it("rings a single hot spot with one closed line per level, each inside the one below", () => {
    // Squares are numbered from the corner, so the frame's middle is between squares 9 and 10.
    const { map, frame } = grid(cone(9.5, 9.5));
    const contours = heatContours(map, frame, LEVELS);
    expect(contours.map((c) => c.level)).toEqual(LEVELS);
    const loops = contours.map((c) => subpaths(c.line));
    for (const lines of loops) {
      expect(lines).toHaveLength(1);
      expect(lines[0].closed).toBe(true);
    }
    const boxes = loops.map((lines) => box(lines[0].points));
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].left).toBeGreaterThan(boxes[i - 1].left);
      expect(boxes[i].right).toBeLessThan(boxes[i - 1].right);
      expect(boxes[i].top).toBeGreaterThan(boxes[i - 1].top);
      expect(boxes[i].bottom).toBeLessThan(boxes[i - 1].bottom);
    }
    // The spot is in the middle of the frame, and so are its rings.
    const top = boxes.at(-1)!;
    expect((top.left + top.right) / 2).toBeCloseTo(frame.width / 2, -1);
    expect((top.top + top.bottom) / 2).toBeCloseTo(frame.height / 2, -1);
  });

  it("puts the lines where the heat is on the map", () => {
    // Hot in the north-west: square (15, 4), with row 0 the southernmost.
    const { map, frame } = grid(cone(15, 4, 4));
    const spot = map.tiles.find((t) => t.heat === 1)!;
    const top = box(subpaths(heatContours(map, frame, LEVELS)[3].line)[0].points);
    expect((top.left + top.right) / 2).toBeCloseTo(frame.x(spot.lon), -1);
    expect((top.top + top.bottom) / 2).toBeCloseTo(frame.y(spot.lat), -1);
    expect(frame.y(spot.lat)).toBeLessThan(frame.height / 3);
  });

  it("parts two hot spots at the top and joins them lower down", () => {
    const { map, frame } = grid((r, c) => Math.max(cone(10, 6, 5)(r, c), cone(10, 13, 5)(r, c)));
    const [lowest, , , top] = heatContours(map, frame, LEVELS).map((c) => subpaths(c.line));
    expect(top.map((line) => line.closed)).toEqual([true, true]);
    expect(lowest.map((line) => line.closed)).toEqual([true]);
  });

  it("measures the levels against the map's own strongest spot", () => {
    const strong = grid(cone(10, 10));
    const faint = grid((r, c) => cone(10, 10)(r, c) / 2);
    expect(heatContours(faint.map, faint.frame, LEVELS)).toEqual(heatContours(strong.map, strong.frame, LEVELS));
  });

  it("keeps the paths inside the frame, and stops a line at the edge rather than running it along", () => {
    // Hot along the western edge: every level crosses it.
    const { map, frame } = grid(cone(10, 0));
    const contours = heatContours(map, frame, LEVELS);
    expect(contours).toHaveLength(4);
    for (const { line, area } of contours) {
      const lines = subpaths(line);
      for (const { points } of [...lines, ...subpaths(area)]) {
        for (const [x, y] of points) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(frame.width);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(frame.height);
        }
      }
      // Each level is one open line from the edge back to the edge, with nothing drawn along it.
      expect(lines).toHaveLength(1);
      const [{ closed, points }] = lines;
      expect(closed).toBe(false);
      expect(points[0][0]).toBe(0);
      expect(points.at(-1)![0]).toBe(0);
      expect(points.slice(1).some((p, i) => p[0] === 0 && points[i][0] === 0)).toBe(false);
      // The ground it encloses is closed off by the edge instead.
      const [ground] = subpaths(area);
      expect(ground.closed).toBe(true);
      expect(ground.points.filter((p) => p[0] === 0).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("draws the same rounded numbers every time, so the server and the browser agree", () => {
    const first = grid((r, c) => Math.max(cone(6, 4)(r, c), cone(15, 13, 6)(r, c) * 0.7));
    const again = grid((r, c) => Math.max(cone(6, 4)(r, c), cone(15, 13, 6)(r, c) * 0.7));
    const contours = heatContours(first.map, first.frame, LEVELS);
    expect(heatContours(again.map, again.frame, LEVELS)).toEqual(contours);
    expect(heatContours(first.map, first.frame, LEVELS)).toEqual(contours);
    for (const value of contours.flatMap((c) => `${c.line}${c.area}`.match(/[\d.]+/g) ?? []).map(Number)) {
      expect(Math.round(value * 100) / 100).toBe(value);
    }
  });

  it("draws the heat around the bounds where a frame widened to fill a box shows it", () => {
    // The strongest spot is 5 squares west of the bounds, in the ground the grid keeps around them (its reach).
    const { map } = grid(() => 0);
    const { bounds, cell } = map as Required<HeatGrid>;
    const tiles = [];
    for (let row = 0; row < 20; row++) {
      for (let col = -10; col < 20; col++) {
        const heat = cone(10, -5)(row, col);
        if (heat > 0) tiles.push({ lat: bounds.south + (row + 0.5) * cell.lat, lon: bounds.west + (col + 0.5) * cell.lon, heat });
      }
    }
    const reach = { ...bounds, west: bounds.west - 10 * cell.lon };
    const frame = mapFrame(widen(bounds, 2, reach));
    const [top] = subpaths(heatContours({ bounds, reach, cell, tiles }, frame, LEVELS)[3].line);
    expect(top.closed).toBe(true);
    const ring = box(top.points);
    expect((ring.left + ring.right) / 2).toBeCloseTo(frame.x(bounds.west - 4.5 * cell.lon), -1);
    expect(ring.right).toBeLessThan(frame.x(bounds.west));
  });

  it("draws nothing for a map with no heat", () => {
    const { map, frame } = grid(() => 0);
    expect(heatContours(map, frame, LEVELS)).toEqual([]);
    expect(heatContours({ ...map, tiles: [{ lat: 19.05, lon: 72.85, heat: 0 }] }, frame, LEVELS)).toEqual([]);
  });

  it("still draws a grid saved before bounds were recorded", () => {
    const { map } = grid(cone(10, 10));
    const { bounds, ...old } = map;
    const frame = mapFrame({
      south: bounds!.south - map.cell.lat / 2,
      north: bounds!.north + map.cell.lat / 2,
      west: bounds!.west - map.cell.lon / 2,
      east: bounds!.east + map.cell.lon / 2,
    });
    const contours = heatContours(old, frame, LEVELS);
    expect(contours.map((c) => subpaths(c.line).length)).toEqual([1, 1, 1, 1]);
  });
});
