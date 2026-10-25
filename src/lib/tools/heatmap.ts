import { z } from "zod";
import { INSIGHT_MODES, entityList, entityUrn, heatmapCells, localityKind, type HeatCell, type QlooClient, type QlooEntity } from "../qloo";
import { mockEntityId } from "../qloo/mock/catalog";
import { defineTool, entityIds, normalizeName } from "./shared";

// Where in a city an audience over-indexes, as a few named areas to base a shoot in. Qloo's heatmap scores
// every geohash tile of the city for the signal; the strongest tiles are grouped into areas and each area is
// named after the neighbourhoods Qloo lists around its centre. The heatmap's own neighbourhood output
// (output.heatmap.boundary=urn:entity:locality) isn't used: it ships every locality's polygon, 5 MB for
// Mumbai and over 5 MiB for New York on the hackathon host (2026-10-25). `take` doesn't trim a heatmap.

export interface HeatArea {
  /** 1 = strongest. */
  rank: number;
  /** The neighbourhood the area is named after, e.g. "East Williamsburg". */
  name: string;
  /** Where that neighbourhood sits, e.g. "Brooklyn" or "G/S Ward". */
  district?: string;
  /** Other neighbourhoods around the centre. */
  near: string[];
  lat: number;
  lon: number;
  radius_m: number;
  /** The area's share of the heat in the city's strongest tiles, 0-1. */
  share: number;
}

/** One square of the map the board draws, at its centre; heat is scaled 0-1 within this city and audience. */
export interface HeatTile {
  lat: number;
  lon: number;
  heat: number;
}

/** The heatmap as the board draws it: equal squares, sized in degrees (square on the ground), within `bounds`. */
export interface HeatGrid {
  /** The frame; missing on grids saved by the first version of this tool, which covered the whole city. */
  bounds?: { south: number; west: number; north: number; east: number };
  cell: { lat: number; lon: number };
  tiles: HeatTile[];
}

/**
 * A tile's heat: how strongly the audience over-indexes there, times how much of its signal is there. Affinity
 * alone ties across many tiles (live Mumbai had hundreds at the top score); the product favours the areas
 * where fans gather, which is also where there are places to shoot. Across five very different artists in New
 * York, their hottest tenths overlapped 43% on this score (32% on affinity alone), so it stays the audience's.
 */
export const heatOf = (cell: HeatCell) => cell.affinity * cell.popularity;

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const round = (value: number, places: number) => Number(value.toFixed(places));

type UnnamedArea = Omit<HeatArea, "name" | "district" | "near">;

/**
 * The strongest areas: the hottest tenth of the tiles (at least 20), each joining the first area whose
 * hottest tile is within radius_m, or starting a new one. Areas rank by total heat; centres are heat-weighted.
 */
export function hotAreas(cells: HeatCell[], count: number, radiusM: number): UnnamedArea[] {
  const ranked = cells.filter((c) => heatOf(c) > 0).sort((a, b) => heatOf(b) - heatOf(a));
  const hot = ranked.slice(0, Math.max(20, Math.ceil(ranked.length / 10)));
  const total = hot.reduce((sum, c) => sum + heatOf(c), 0);
  const groups: { seed: HeatCell; cells: HeatCell[]; heat: number }[] = [];
  for (const cell of hot) {
    const group = groups.find((g) => distanceM(g.seed, cell) <= radiusM);
    if (group) {
      group.cells.push(cell);
      group.heat += heatOf(cell);
    } else {
      groups.push({ seed: cell, cells: [cell], heat: heatOf(cell) });
    }
  }
  return groups
    .sort((a, b) => b.heat - a.heat)
    .slice(0, count)
    .map((g, i) => ({
      rank: i + 1,
      lat: round(g.cells.reduce((sum, c) => sum + c.lat * heatOf(c), 0) / g.heat, 5),
      lon: round(g.cells.reduce((sum, c) => sum + c.lon * heatOf(c), 0) / g.heat, 5),
      radius_m: radiusM,
      share: round(g.heat / total, 3),
    }));
}

const METRES_PER_DEGREE = 111_320;
/** Room around the outermost area, and the smallest frame either way, so rings and pins read at a glance. */
const FRAME_MARGIN_M = 1_500;
const MIN_FRAME_M = 6_000;
/** No frame taller than 5:4 or wider than 8:5: a long city (Mumbai) gets more of the land and sea beside it. */
const MAX_TALL = 1.25;
const MAX_WIDE = 1.6;

/** A geohash tile's longer side on the ground, in degrees of latitude. */
function tileSize(precision: number, kx: number): number {
  const bits = 5 * precision;
  return Math.max(180 / 2 ** Math.floor(bits / 2), (360 / 2 ** Math.ceil(bits / 2)) * kx);
}

/**
 * The heatmap as the board draws it, framed on the strongest areas so their rings and the scouted places read
 * clearly (the whole city when there are none). Qloo's tiles (150 m to 5 km, thousands per city) are binned
 * into squares about 1/`across` of the frame, never finer than Qloo's own tiles, each keeping its hottest tile.
 */
export function heatGrid(
  cells: HeatCell[],
  areas: { lat: number; lon: number; radius_m: number }[] = [],
  across = 40,
): HeatGrid | undefined {
  if (cells.length === 0) return undefined;
  const spots =
    areas.length > 0 ? areas.map((a) => ({ ...a, reach: a.radius_m + FRAME_MARGIN_M })) : cells.map((c) => ({ ...c, reach: 0 }));
  const kx = Math.cos(((spots.reduce((sum, s) => sum + s.lat, 0) / spots.length) * Math.PI) / 180);
  let south = Math.min(...spots.map((s) => s.lat - s.reach / METRES_PER_DEGREE));
  let north = Math.max(...spots.map((s) => s.lat + s.reach / METRES_PER_DEGREE));
  let west = Math.min(...spots.map((s) => s.lon - s.reach / METRES_PER_DEGREE / kx));
  let east = Math.max(...spots.map((s) => s.lon + s.reach / METRES_PER_DEGREE / kx));
  // Grow the short side (in ground degrees), keeping the frame centred.
  const tall = Math.max(north - south, MIN_FRAME_M / METRES_PER_DEGREE, ((east - west) * kx) / MAX_WIDE);
  const wide = Math.max((east - west) * kx, MIN_FRAME_M / METRES_PER_DEGREE, tall / MAX_TALL);
  const [midLat, midLon] = [(north + south) / 2, (east + west) / 2];
  [south, north, west, east] = [midLat - tall / 2, midLat + tall / 2, midLon - wide / kx / 2, midLon + wide / kx / 2];

  const inside = cells.filter((c) => c.lat >= south && c.lat <= north && c.lon >= west && c.lon <= east);
  if (inside.length === 0) return undefined;
  const precisions = new Map<number, number>();
  for (const c of inside) precisions.set(c.precision, (precisions.get(c.precision) ?? 0) + 1);
  const typical = [...precisions].sort((a, b) => b[1] - a[1])[0][0];
  const size = Math.max(Math.max(tall, wide) / across, typical > 0 ? tileSize(typical, kx) : 0);
  const cell = { lat: size, lon: size / kx };
  const bins = new Map<string, HeatTile>();
  for (const c of inside) {
    const row = Math.floor((c.lat - south) / cell.lat);
    const col = Math.floor((c.lon - west) / cell.lon);
    const bin = bins.get(`${row}:${col}`);
    if (!bin || heatOf(c) > bin.heat) {
      bins.set(`${row}:${col}`, { lat: south + (row + 0.5) * cell.lat, lon: west + (col + 0.5) * cell.lon, heat: heatOf(c) });
    }
  }
  const top = Math.max(...[...bins.values()].map((b) => b.heat));
  return {
    bounds: { south: round(south, 5), west: round(west, 5), north: round(north, 5), east: round(east, 5) },
    cell: { lat: round(cell.lat, 6), lon: round(cell.lon, 6) },
    tiles: [...bins.values()].map((b) => ({ lat: round(b.lat, 5), lon: round(b.lon, 5), heat: top > 0 ? round(b.heat / top, 3) : 0 })),
  };
}

/**
 * Neighbourhood-sized locality kinds. Live Qloo also returns wards with no kind ("G/S Ward"), islands, counties
 * and boroughs; Manhattan is tagged a suburb, so parents are dropped separately below.
 */
const SMALL_KINDS = new Set(["suburb", "neighbourhood", "quarter"]);

/** A suburb ("Lower Parel") reads better than a neighbourhood block ("Nehru Nagar"); then the better-known name. */
const nameRank = (e: QlooEntity) => (localityKind(e) === "suburb" ? 1 : 0) + (e.popularity ?? 0);

async function nameArea(
  qloo: QlooClient,
  area: UnnamedArea,
  city: { id?: string; name: string },
): Promise<Pick<HeatArea, "name" | "district" | "near"> | undefined> {
  const response = await qloo.search({
    types: entityUrn("locality"),
    "filter.location": `${area.lat},${area.lon}`,
    // /search takes miles, not metres: one mile is about the reach of a shoot base.
    "filter.radius": 1,
    sort_by: "distance",
    take: 8,
  });
  const nearby = entityList(response.data).filter((e) => e.entity_id !== city.id && SMALL_KINDS.has(localityKind(e) ?? ""));
  // A place the others name as their parent ("Upper East Side, Manhattan, ...") is too big to name an area after.
  const parents = new Set(nearby.flatMap((e) => (e.disambiguation ?? "").split(",").slice(1).map(normalizeName)));
  const around = nearby.filter((e) => !parents.has(normalizeName(e.name)));
  const [best] = around.slice(0, 2).sort((a, b) => nameRank(b) - nameRank(a));
  if (!best) return undefined;
  const same = (a: string, b: string) => normalizeName(a) === normalizeName(b);
  const district = best.disambiguation?.split(",")[1]?.trim();
  return {
    name: best.name,
    district: district && !same(district, best.name) && !same(district, city.name) ? district : undefined,
    near: [...new Set(around.map((e) => e.name))].filter((name) => !same(name, best.name)).slice(0, 3),
  };
}

export const audienceHeatmap = defineTool({
  name: "audience_heatmap",
  description:
    "Map where in a city the audience of the given entities over-indexes (Qloo's heatmap) and return the strongest areas, " +
    "named after their neighbourhoods, as candidate shoot bases. Call this once the artist or touchstones are resolved and " +
    "before scout_locations; pass the chosen area's centre and radius to scout_locations as `near` so the shoot stays in one " +
    "area. These are aggregate affinities by area, never facts about the people who live there.",
  inputSchema: z.strictObject({
    signal_entity_ids: entityIds(10).describe("The artist and/or touchstones whose audience to map."),
    city: z.string().min(1).describe('The shoot city as the user wrote it, e.g. "Mumbai".'),
    locality_id: z
      .string()
      .min(1)
      .optional()
      .describe("The city's Qloo ID from resolve_entities (type locality); more exact than the name."),
    areas: z.number().int().min(1).max(5).default(3).describe("How many areas to return (1-5)."),
    radius_m: z.number().int().min(500).max(5000).default(2000).describe("How far an area reaches from its centre, in metres."),
  }),
  example: { signal_entity_ids: [mockEntityId("Prateek Kuhad")], city: "Mumbai" },
  async run(input, { qloo }) {
    const response = await qloo.insights({
      "filter.type": INSIGHT_MODES.heatmap,
      ...(input.locality_id ? { "filter.location": input.locality_id } : { "filter.location.query": input.city }),
      "signal.interests.entities": input.signal_entity_ids,
    });
    const cells = heatmapCells(response.data);
    const found = hotAreas(cells, input.areas, input.radius_m);
    const names = await Promise.all(found.map((area) => nameArea(qloo, area, { id: input.locality_id, name: input.city })));
    const areas: HeatArea[] = found
      .flatMap((area, i) => {
        const name = names[i];
        return name ? [{ ...area, ...name }] : [];
      })
      .map((area, i) => ({ ...area, rank: i + 1 }));
    const label = (a: HeatArea) => `${a.name}${a.district ? `, ${a.district}` : ""}`;
    return {
      status: areas.length > 0 ? "ok" : "empty",
      summary:
        areas.length > 0
          ? `Strongest around ${label(areas[0])}${areas.length > 1 ? `; then ${areas.slice(1).map(label).join("; ")}` : ""}.`
          : cells.length > 0
            ? `Qloo mapped ${input.city}, but no strong area could be named.`
            : `Qloo returned no heatmap for ${input.city}.`,
      data: { areas, map: heatGrid(cells, areas) },
      warnings: response.warnings,
    };
  },
});
