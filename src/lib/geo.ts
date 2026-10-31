// Distances and map frames on the ground, shared by the server (the heatmap tool frames its grid) and the browser (the
// board frames its map). Plain functions, no Qloo client.

export const METRES_PER_DEGREE = 111_320;
/** Room around the outermost area, and the smallest frame either way, so rings and pins read at a glance. */
export const FRAME_MARGIN_M = 1_500;
const MIN_FRAME_M = 6_000;
/** No frame taller than 5:4 or wider than 8:5: a long city (Mumbai) gets more of the land and sea beside it. */
const MAX_TALL = 1.25;
const MAX_WIDE = 1.6;

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export interface GroundFrame {
  south: number;
  north: number;
  west: number;
  east: number;
  /** The frame's height and width in degrees of latitude, so the same on the ground, its centre, and the longitude scale. */
  tall: number;
  wide: number;
  midLat: number;
  midLon: number;
  kx: number;
}

/**
 * The ground around some spots, each with room `reach` (metres) around it: at least MIN_FRAME_M either way, its short side
 * grown to stay within 5:4 tall or 8:5 wide, centred on the spots.
 */
export function frameAround(spots: { lat: number; lon: number; reach: number }[]): GroundFrame {
  const kx = Math.cos(((spots.reduce((sum, s) => sum + s.lat, 0) / spots.length) * Math.PI) / 180);
  const south = Math.min(...spots.map((s) => s.lat - s.reach / METRES_PER_DEGREE));
  const north = Math.max(...spots.map((s) => s.lat + s.reach / METRES_PER_DEGREE));
  const west = Math.min(...spots.map((s) => s.lon - s.reach / METRES_PER_DEGREE / kx));
  const east = Math.max(...spots.map((s) => s.lon + s.reach / METRES_PER_DEGREE / kx));
  // Grow the short side (in ground degrees), keeping the frame centred.
  const tall = Math.max(north - south, MIN_FRAME_M / METRES_PER_DEGREE, ((east - west) * kx) / MAX_WIDE);
  const wide = Math.max((east - west) * kx, MIN_FRAME_M / METRES_PER_DEGREE, tall / MAX_TALL);
  const [midLat, midLon] = [(north + south) / 2, (east + west) / 2];
  return {
    south: midLat - tall / 2,
    north: midLat + tall / 2,
    west: midLon - wide / kx / 2,
    east: midLon + wide / kx / 2,
    tall,
    wide,
    midLat,
    midLon,
    kx,
  };
}
