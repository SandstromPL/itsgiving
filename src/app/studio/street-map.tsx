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

export interface MapFrame {
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
 * low, a little more contrast, so water stays darker than land and streets show as faint lines under the heat.
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
    <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[inherit] [filter:grayscale(1)_brightness(0.3)_contrast(1.2)]">
      {tiles.map(({ x, y }) => (
        // eslint-disable-next-line @next/next/no-img-element -- map tiles, placed by hand; the optimizer would only re-encode them
        <img
          key={`${x}:${y}`}
          src={`https://tile.openstreetmap.org/${zoom}/${((x % count) + count) % count}/${y}.png`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
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

/** OpenStreetMap's credit, as its licence asks: on the map's corner, or right under a map too small to spare one. */
export function MapCredit({ under = false }: { under?: boolean }) {
  return (
    <a
      href="https://www.openstreetmap.org/copyright"
      target="_blank"
      rel="noreferrer"
      className={`text-[11px] leading-none text-dim hover:text-foreground ${
        under ? "" : "absolute right-1.5 bottom-1.5 z-20 rounded-[4px] bg-frame/85 px-1.5 py-[6.5px] print:bg-transparent"
      }`}
    >
      © OpenStreetMap contributors
    </a>
  );
}
