import { blur2 } from "d3-array";
import { contours } from "d3-contour";
import type { HeatGrid } from "@/lib/tools/heatmap";
import { fixed, type MapFrame } from "./street-map";

// Qloo's heatmap as contour lines, like the height lines on a walking map. The grid's squares become one surface (a
// missing square is no heat), blurred by about a square so even New York's coarse grids (some 15 squares across) give
// round lines, then traced at heights relative to the map's strongest spot. Lines are in the frame's units and rounded
// like it, so the server and the browser draw the same paths.

type Point = [number, number];

export interface HeatContour {
  /** The height, as a fraction of the map's strongest spot. */
  level: number;
  /** The lines as SVG path data: closed loops, or open where a line leaves the frame. */
  line: string;
  /** The ground at or above this height, cut to the frame, as SVG path data for an even-odd fill. */
  area: string;
}

/** The surface is traced on cells about this size in frame units, finer than the squares, so lines bend smoothly. */
const STEP = 5;

/** The contours of `map` at each of `levels` (fractions of its strongest spot, ascending), in `frame`'s units. */
export function heatContours(map: HeatGrid, frame: MapFrame, levels: readonly number[]): HeatContour[] {
  const { cell, tiles } = map;
  if (tiles.length === 0) return [];
  // Squares sit on a lattice from the grid's south-west corner (on grids saved without bounds, from the corner of their
  // own squares).
  const south = map.bounds?.south ?? Math.min(...tiles.map((t) => t.lat)) - cell.lat / 2;
  const west = map.bounds?.west ?? Math.min(...tiles.map((t) => t.lon)) - cell.lon / 2;
  const heat = new Map(
    tiles.map((t) => [`${Math.round((t.lat - south) / cell.lat - 0.5)}:${Math.round((t.lon - west) / cell.lon - 0.5)}`, t.heat]),
  );
  // The squares that cover the frame, and one more all round carrying on its edge's heat: a line that reaches the edge
  // crosses it and closes out of sight, rather than running along the edge as if the heat stopped there.
  const { bounds } = frame;
  const [col0, col1] = [Math.floor((bounds.west - west) / cell.lon), Math.ceil((bounds.east - west) / cell.lon) - 1];
  const [row0, row1] = [Math.floor((bounds.south - south) / cell.lat), Math.ceil((bounds.north - south) / cell.lat) - 1];
  const k = Math.max(1, Math.round((frame.x(west + cell.lon) - frame.x(west)) / STEP));
  const width = (col1 - col0 + 3) * k;
  const height = (row1 - row0 + 3) * k;
  // Row by row from the north, as the frame is drawn.
  const values = Array.from({ length: width * height }, (_, i) => {
    const row = Math.min(row1, Math.max(row0, row1 + 1 - Math.floor(Math.floor(i / width) / k)));
    const col = Math.min(col1, Math.max(col0, col0 - 1 + Math.floor((i % width) / k)));
    return heat.get(`${row}:${col}`) ?? 0;
  });
  blur2({ data: values, width, height }, k);
  const peak = values.reduce((top, v) => Math.max(top, v), 0);
  if (peak <= 0) return [];

  const place = ([x, y]: number[]): Point => [
    frame.x(west + (col0 - 1 + x / k) * cell.lon),
    frame.y(south + (row1 + 2 - y / k) * cell.lat),
  ];
  return contours()
    .size([width, height])
    .thresholds(levels.map((level) => level * peak))(values)
    .map((traced, i) => {
      const rings = traced.coordinates.flat().map((ring) => ring.map(place));
      return {
        level: levels[i],
        line: rings.flatMap((ring) => inside(ring, frame.width, frame.height).map(({ points, closed }) => path(points, closed))).join(""),
        area: rings
          .map((ring) => cut(ring, frame.width, frame.height))
          .filter((ring) => ring.length > 2)
          .map((ring) => path(ring, true))
          .join(""),
      };
    });
}

/** SVG path data through `points`, skipping repeats (rounding can land two on one spot). */
function path(points: Point[], closed: boolean): string {
  const kept = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (closed && kept.length > 1 && kept[0][0] === kept.at(-1)![0] && kept[0][1] === kept.at(-1)![1]) kept.pop();
  return `M${kept.map(([x, y]) => `${x} ${y}`).join("L")}${closed ? "Z" : ""}`;
}

/** The part of the segment from a to b inside the box [0, w] × [0, h] (Liang–Barsky); a stretch along its edge isn't. */
function clipSegment(a: Point, b: Point, w: number, h: number): [Point, Point] | undefined {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a[0]],
    [dx, w - a[0]],
    [-dy, a[1]],
    [dy, h - a[1]],
  ]) {
    if (p === 0) {
      if (q <= 0) return undefined;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  if (t0 >= t1) return undefined;
  const at = (t: number): Point => [fixed(a[0] + t * dx), fixed(a[1] + t * dy)];
  return [t0 > 0 ? at(t0) : a, t1 < 1 ? at(t1) : b];
}

/**
 * A ring's stretches inside the box [0, w] × [0, h], each an open line from edge to edge; a ring wholly inside stays
 * one closed loop. d3 ends a ring on a copy of its first point.
 */
function inside(ring: Point[], w: number, h: number): { points: Point[]; closed: boolean }[] {
  const pieces: Point[][] = [];
  let open: Point[] | undefined;
  for (let i = 1; i < ring.length; i++) {
    const piece = clipSegment(ring[i - 1], ring[i], w, h);
    if (!piece) {
      open = undefined;
      continue;
    }
    if (open && piece[0] === ring[i - 1]) open.push(piece[1]);
    else pieces.push((open = [...piece]));
    if (piece[1] !== ring[i]) open = undefined;
  }
  const [first, last] = [pieces[0], pieces.at(-1)];
  if (!first || !last) return [];
  const throughStart = first[0] === ring[0] && last.at(-1) === ring.at(-1);
  if (throughStart && pieces.length === 1) return [{ points: first, closed: true }];
  // The ring starts inside the box, so its first and last stretches are one line through that start.
  if (throughStart) pieces[0] = [...pieces.pop()!, ...first.slice(1)];
  return pieces.map((points) => ({ points, closed: false }));
}

/** A ring cut to the box [0, w] × [0, h] (Sutherland–Hodgman), for filling: where it leaves the box, the box's edge closes it. */
function cut(ring: Point[], w: number, h: number): Point[] {
  let points = ring.slice(0, -1);
  for (const [axis, edge, side] of [
    [0, 0, 1],
    [0, w, -1],
    [1, 0, 1],
    [1, h, -1],
  ]) {
    const keeps = (p: Point) => (p[axis] - edge) * side >= 0;
    const cross = (a: Point, b: Point): Point => {
      const along = fixed(a[1 - axis] + ((edge - a[axis]) / (b[axis] - a[axis])) * (b[1 - axis] - a[1 - axis]));
      return axis === 0 ? [edge, along] : [along, edge];
    };
    const input = points;
    points = [];
    input.forEach((p, i) => {
      const before = input[(i + input.length - 1) % input.length];
      if (keeps(p) !== keeps(before)) points.push(cross(before, p));
      if (keeps(p)) points.push(p);
    });
  }
  return points;
}
