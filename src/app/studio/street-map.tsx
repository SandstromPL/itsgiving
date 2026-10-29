// A street map under the heatmap, so it reads as a place rather than a grid of squares: OpenStreetMap's standard
// tiles, darkened to sit in a dark frame, in the Web Mercator projection everything drawn on top uses. Per OSM's tile
// policy (https://operations.osmfoundation.org/policies/tiles/), the browser fetches only the tiles a frame shows,
// lazily, with its normal Referer, and the credit stays visible on the map.

const TILE = 256;
const EARTH_M = 40_075_016.686;

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Rounded, so the server and the browser print the same numbers: their Math.log and Math.sin can differ in the last
 * bits, and React would call the difference a hydration mismatch. A hundredth of a pixel is plenty for a map.
 */
export const fixed = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** Web Mercator, in world pixels at `zoom`. */
function project(lat: number, lon: number, zoom: number) {
  const world = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * world, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world };
}

/** The latitude and longitude at world pixel (x, y) at `zoom`. */
function unproject(x: number, y: number, zoom: number) {
  const world = TILE * 2 ** zoom;
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI, lon: (x / world) * 360 - 180 };
}

/**
 * `bounds` grown about its centre on whichever side falls short of `aspect` (width over height, as drawn), for a frame
 * that fills a box of that shape; never past `limit`, the ground the heat is known for, though never inside `bounds`.
 */
export function widen(bounds: Bounds, aspect: number, limit?: Bounds): Bounds {
  const nw = project(bounds.north, bounds.west, 0);
  const se = project(bounds.south, bounds.east, 0);
  const width = Math.max(se.x - nw.x, (se.y - nw.y) * aspect);
  const height = Math.max(se.y - nw.y, width / aspect);
  const [cx, cy] = [(nw.x + se.x) / 2, (nw.y + se.y) / 2];
  const corner = unproject(cx - width / 2, cy - height / 2, 0);
  const opposite = unproject(cx + width / 2, cy + height / 2, 0);
  const grown = { north: corner.lat, west: corner.lon, south: opposite.lat, east: opposite.lon };
  if (!limit) return grown;
  return {
    south: Math.max(grown.south, Math.min(limit.south, bounds.south)),
    north: Math.min(grown.north, Math.max(limit.north, bounds.north)),
    west: Math.max(grown.west, Math.min(limit.west, bounds.west)),
    east: Math.min(grown.east, Math.max(limit.east, bounds.east)),
  };
}

export interface MapFrame {
  /** What the frame shows, edge to edge. */
  bounds: Bounds;
  /** The tiles' zoom level. */
  zoom: number;
  /** The frame in its own units, `long` on the longer side (about a pixel each at desktop width). */
  width: number;
  height: number;
  x: (lon: number) => number;
  y: (lat: number) => number;
  /** A ground distance at `lat`, in frame units. */
  metres: (m: number, lat: number) => number;
  /** The frame's corner and size in world pixels at `zoom`, where the tiles are placed. */
  world: { left: number; top: number; width: number; height: number };
}

/**
 * The frame on `bounds`: drawn `long` units on its longer side, with tiles at the zoom that puts at least `sharp`
 * world pixels across that side, so they are never stretched much past their own size.
 */
export function mapFrame(bounds: Bounds, long = 600, sharp = 560): MapFrame {
  const spanAt = (zoom: number) => {
    const nw = project(bounds.north, bounds.west, zoom);
    const se = project(bounds.south, bounds.east, zoom);
    return Math.max(se.x - nw.x, se.y - nw.y);
  };
  let zoom = 3;
  while (zoom < 17 && spanAt(zoom) < sharp) zoom++;
  const nw = project(bounds.north, bounds.west, zoom);
  const se = project(bounds.south, bounds.east, zoom);
  const world = { left: nw.x, top: nw.y, width: se.x - nw.x, height: se.y - nw.y };
  const k = long / Math.max(world.width, world.height);
  return {
    bounds,
    zoom,
    width: fixed(world.width * k),
    height: fixed(world.height * k),
    x: (lon) => fixed((project(0, lon, zoom).x - nw.x) * k),
    y: (lat) => fixed((project(lat, 0, zoom).y - nw.y) * k),
    metres: (m, lat) => fixed(((m * TILE * 2 ** zoom) / (EARTH_M * Math.cos((lat * Math.PI) / 180))) * k),
    world,
  };
}

/**
 * The street tiles behind a frame, placed in percentages so they scale with it, and darkened as one layer: grey,
 * low, a little more contrast, so water stays darker than land and streets show as faint lines under the heat. On
 * paper they're grey and pale instead, under ink.
 */
export function StreetTiles({ frame }: { frame: MapFrame }) {
  const { zoom, world } = frame;
  const count = 2 ** zoom;
  const tiles: { x: number; y: number }[] = [];
  for (let y = Math.max(0, Math.floor(world.top / TILE)); y <= Math.min(count - 1, Math.floor((world.top + world.height) / TILE)); y++) {
    for (let x = Math.floor(world.left / TILE); x <= Math.floor((world.left + world.width) / TILE); x++) tiles.push({ x, y });
  }
  const at = (offset: number, size: number) => `${fixed((offset / size) * 100, 3)}%`;
  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden rounded-[inherit] [filter:grayscale(1)_brightness(0.3)_contrast(1.2)] print:opacity-60 print:[filter:grayscale(1)]"
    >
      {tiles.map(({ x, y }) => (
        // eslint-disable-next-line @next/next/no-img-element -- map tiles, placed by hand; the optimizer would only re-encode them
        <img
          key={`${x}:${y}`}
          src={`https://tile.openstreetmap.org/${zoom}/${((x % count) + count) % count}/${y}.png`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          // A tile that doesn't come (offline, or refused) leaves the dark frame, not the browser's broken-image mark,
          // including one that failed before the page came to life, when no handler was listening yet.
          onError={(event) => (event.currentTarget.style.visibility = "hidden")}
          ref={(img) => {
            if (img?.complete && img.naturalWidth === 0) img.style.visibility = "hidden";
          }}
          className="absolute max-w-none select-none"
          style={{
            left: at(x * TILE - world.left, world.width),
            top: at(y * TILE - world.top, world.height),
            // A pixel of overlap, so no seam shows between neighbours at fractional sizes.
            width: `calc(${at(TILE, world.width)} + 1px)`,
            height: `calc(${at(TILE, world.height)} + 1px)`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The corner of the map the credit takes, in screen pixels from the bottom-right: its chip (189 × 25 at the label
 * size), its inset and a little room. Names placed on the map keep out of it.
 */
export const CREDIT_CORNER = { width: 200, height: 34 };

/** OpenStreetMap's credit, as its licence asks: on the map's corner, or right under a map too small to spare one. */
export function MapCredit({ under = false }: { under?: boolean }) {
  return (
    <a
      href="https://www.openstreetmap.org/copyright"
      target="_blank"
      rel="noreferrer"
      className={`text-label leading-none text-dim hover:text-foreground ${
        under ? "" : "absolute right-1.5 bottom-1.5 z-20 rounded-[4px] bg-frame/85 px-1.5 py-[6.5px]"
      }`}
    >
      © OpenStreetMap contributors
    </a>
  );
}
