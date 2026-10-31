import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { ShootBase, Treatment } from "@/lib/agent/types";
import type { HeatGrid } from "@/lib/tools/heatmap";
import { heatContours } from "./contours";
import { CREDIT_CORNER, MapCredit, StreetTiles, fixed, mapFrame, widen, type Bounds } from "./street-map";
import { evidenceTone, rankMark } from "./ui";

// The shoot base: Qloo's heatmap around the strongest areas for this audience, as contour lines on the city's streets,
// with the areas as rings, the one the planner chose, and the scouted locations as numbered pins. Lines, rings and
// leader lines are SVG and scale with the map; names and numbers are HTML on top, so they stay legible at any width.
// One drawing everywhere: a treatment's board and the homepage's "How it works" both use ShootBaseBlock.

/** The frame's longer side in SVG units; about a pixel each on a desktop screen. */
const W = 600;
/** The street tiles' zoom puts at least this many of their pixels across the frame's longer side (mapFrame). */
const SHARP = 560;
/** Pins closer than this (in SVG units) are nudged apart, each with a leader line to its true spot. */
const PIN_GAP = 26;

export interface Pin {
  n: number;
  name: string;
  lat: number;
  lon: number;
}

/** The scouted places that have coordinates, numbered as on the location cards. */
export function locationPins(t: Treatment): Pin[] {
  return t.locations.flatMap((l, i) => {
    const p = l.entity.place;
    return p?.lat !== undefined && p?.lon !== undefined ? [{ n: i + 1, name: l.entity.name, lat: p.lat, lon: p.lon }] : [];
  });
}

/**
 * The contour lines, weakest first, at fractions of the map's strongest spot: one hue that gains weight and strength
 * with the heat (a sequential scale), and a faint fill inside the top line only, so the eye finds the strongest ground
 * first and the streets show through everywhere. Widths are screen pixels. Even the faintest line is 3:1 on the streets
 * under it, lime or pink on screen and ink or pink on paper.
 */
const LINES = [
  { level: 0.2, width: 1, opacity: 0.65 },
  { level: 0.4, width: 1.4, opacity: 0.77 },
  { level: 0.6, width: 1.8, opacity: 0.88 },
  { level: 0.8, width: 2.25, opacity: 1 },
];
const LEVELS = LINES.map((l) => l.level);
const TOP_FILL = 0.14;

/** What the map frames: the grid's bounds, grown to keep every pin inside. */
function frameBounds(map: HeatGrid, pins: Pin[]): Bounds {
  // Grids saved before bounds were recorded are framed on their own squares.
  let { south, west, north, east } = map.bounds ?? {
    south: Math.min(...map.tiles.map((t) => t.lat)) - map.cell.lat,
    north: Math.max(...map.tiles.map((t) => t.lat)) + map.cell.lat,
    west: Math.min(...map.tiles.map((t) => t.lon)) - map.cell.lon,
    east: Math.max(...map.tiles.map((t) => t.lon)) + map.cell.lon,
  };
  for (const p of pins) {
    south = Math.min(south, p.lat - map.cell.lat);
    north = Math.max(north, p.lat + map.cell.lat);
    west = Math.min(west, p.lon - map.cell.lon);
    east = Math.max(east, p.lon + map.cell.lon);
  }
  return { south, west, north, east };
}

interface Point {
  x: number;
  y: number;
}

const near = (a: Point, b: Point, gap: number) => Math.abs(a.x - b.x) < gap && Math.abs(a.y - b.y) < gap;

/** Where each pin goes: its own spot, or the nearest free one on rings around it when another pin is there. */
function placePins(spots: Point[]): Point[] {
  const placed: Point[] = [];
  for (const spot of spots) {
    let at = spot;
    for (let ring = 1; ring <= 4 && placed.some((p) => near(p, at, PIN_GAP)); ring++) {
      // Rounded like the frame, so the server and the browser place a nudged pin on the same spot.
      const options = Array.from({ length: 8 }, (_, k) => ({
        x: fixed(spot.x + Math.cos((k * Math.PI) / 4 - Math.PI / 2) * PIN_GAP * ring),
        y: fixed(spot.y + Math.sin((k * Math.PI) / 4 - Math.PI / 2) * PIN_GAP * ring),
      }));
      at = options.find((o) => !placed.some((p) => near(p, o, PIN_GAP))) ?? at;
    }
    placed.push(at);
  }
  return placed;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type Side = "above" | "below" | "right" | "left";

/** Where a name goes: beside its ring, and above or below it either centred or slid to the left or right. */
interface Placement {
  side: Side;
  along: -1 | 0 | 1;
}

/** The places to try, best first: centred above or below, then slid along the ring's top or bottom, then its sides. */
const PLACEMENTS: Placement[] = [
  { side: "above", along: 0 },
  { side: "below", along: 0 },
  { side: "above", along: -1 },
  { side: "above", along: 1 },
  { side: "below", along: -1 },
  { side: "below", along: 1 },
  { side: "right", along: 0 },
  { side: "left", along: 0 },
];

const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
const overlap = (a: Box, b: Box) =>
  area({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  });

interface Ring {
  name: string;
  x: number;
  y: number;
  r: number;
}

/**
 * The box an area's name takes beside its ring. Names are HTML at a fixed size, so in SVG units they grow as the map
 * shrinks: `scale` is screen pixels per SVG unit (1 before the map is measured).
 */
export function nameBox(ring: Ring, { side, along }: Placement, scale = 1): Box {
  const w = (ring.name.length * 6.6 + 10) / scale;
  const h = 18 / scale;
  const gap = 4 / scale;
  if (side === "right" || side === "left") {
    const left = side === "right" ? ring.x + ring.r + gap : ring.x - ring.r - gap - w;
    return { left, right: left + w, top: ring.y - h / 2, bottom: ring.y + h / 2 };
  }
  const left = ring.x + ((along - 1) * w) / 2;
  const top = side === "above" ? ring.y - ring.r - gap - h : ring.y + ring.r + gap;
  return { left, right: left + w, top, bottom: top + h };
}

/** The pins' dots and the OpenStreetMap credit's corner: what nothing written on the map may cover. */
function fixtures(pins: Point[], width: number, height: number, scale: number): Box[] {
  const px = (n: number) => n / scale;
  return [
    ...pins.map((p) => ({ left: p.x - px(10), top: p.y - px(10), right: p.x + px(10), bottom: p.y + px(10) })),
    { left: width - px(CREDIT_CORNER.width), top: height - px(CREDIT_CORNER.height), right: width, bottom: height },
  ];
}

/** How much of a box would be hidden: under what's taken, or cut off by the frame. */
function hiddenArea(b: Box, taken: Box[], width: number, height: number): number {
  return taken.reduce((sum, t) => sum + overlap(b, t), 0) + area(b) - overlap(b, { left: 0, top: 0, right: width, bottom: height });
}

/**
 * Each area's name beside its ring, in the first place that stays in the frame and clear of the pins, the
 * OpenStreetMap credit and the names placed before it; where no place is clear, in the one that hides least of it.
 */
export function placeLabels(rings: Ring[], pins: Point[], width: number, height: number, scale = 1): Placement[] {
  const taken = fixtures(pins, width, height, scale);
  const hidden = (b: Box) => hiddenArea(b, taken, width, height);
  return rings.map((ring) => {
    const box = (p: Placement) => nameBox(ring, p, scale);
    const placement =
      PLACEMENTS.find((p) => hidden(box(p)) === 0) ?? PLACEMENTS.reduce((best, p) => (hidden(box(p)) < hidden(box(best)) ? p : best));
    taken.push(box(placement));
    return placement;
  });
}

/** Where the lit pin's name goes: the side of its dot, and how far it slides sideways when above or below. */
export interface PinName {
  side: Side;
  /** Above or below, the slide (SVG units) from centred over the dot that keeps the name inside the frame. */
  slide: number;
}

/** From a lit dot's centre to its name, in screen pixels: clear of the dot (30px) and most of its halo. */
const PIN_NAME_OFFSET = 20;

/**
 * A place's name as the map labels its pin: without a description or a neighbourhood added after it ("Fresh Catch By
 * Francis - Coastal and Seafood Restaurant", "Poco Loco Tapas & Bar, Khar"), so it fits among the others. The location
 * card beside the map, and the pin's tooltip, have the whole name.
 */
export function mapName(name: string): string {
  const head = name.split(/\s+[-–—|]\s+|,\s+|\s+\(/)[0].trim();
  return head.length >= 3 ? head : name;
}

/**
 * The lit pin's name, 12px bold in its pill: on the dot's roomier side as before when that's clear, else the other
 * side, then above, then below, whichever first stays in the frame and clear of the area names, the other pins and the
 * credit; where none is clear, the one that hides least of it. A small map left the name over its own shoot base's.
 */
export function placePinName(
  pin: Point,
  name: string,
  rings: Ring[],
  names: Placement[],
  others: Point[],
  width: number,
  height: number,
  scale = 1,
): PinName {
  const px = (n: number) => n / scale;
  // The pill as drawn: 12px bold on the page's line height, with its padding.
  const w = px(name.length * 6.6 + 12);
  const h = px(22);
  const off = px(PIN_NAME_OFFSET);
  const taken = [...fixtures(others, width, height, scale), ...rings.map((ring, i) => nameBox(ring, names[i], scale))];
  const sides: Side[] = pin.x > width / 2 ? ["left", "right", "above", "below"] : ["right", "left", "above", "below"];
  const place = (side: Side): PinName & { box: Box } => {
    if (side === "right" || side === "left") {
      const left = side === "right" ? pin.x + off : pin.x - off - w;
      return { side, slide: 0, box: { left, right: left + w, top: pin.y - h / 2, bottom: pin.y + h / 2 } };
    }
    // Centred over the dot, slid back inside the frame where it would run off a side.
    const centred = pin.x - w / 2;
    const left = w >= width ? 0 : Math.min(Math.max(centred, 0), width - w);
    const top = side === "above" ? pin.y - off - h : pin.y + off;
    return { side, slide: fixed(left - centred), box: { left, right: left + w, top, bottom: top + h } };
  };
  const options = sides.map(place);
  const hidden = (o: { box: Box }) => hiddenArea(o.box, taken, width, height);
  const { side, slide } = options.find((o) => hidden(o) === 0) ?? options.reduce((best, o) => (hidden(o) < hidden(best) ? o : best));
  return { side, slide };
}

/**
 * The lit pin's name placed as CSS, from the dot's centre: beside it, cut short at the frame's edge if it must be, or
 * centred above or below it, slid back inside the frame. `x` is the dot's position across the frame, in percent.
 */
function pinNameStyle({ side, slide }: PinName, x: number, scale: number): CSSProperties {
  const off = `${PIN_NAME_OFFSET}px`;
  if (side === "right") return { transform: `translate(${off}, -50%)`, maxWidth: `calc(${fixed(100 - x)}% - 28px)` };
  if (side === "left") return { transform: `translate(calc(-100% - ${off}), -50%)`, maxWidth: `calc(${fixed(x)}% - 28px)` };
  const along = `calc(-50% + ${fixed(slide * scale)}px)`;
  return { transform: `translate(${along}, ${side === "above" ? `calc(-100% - ${off})` : off})`, maxWidth: "calc(100% - 8px)" };
}

/** A name's offset from the point of its ring it's placed at, matching the boxes above. */
const labelShift = ({ side, along }: Placement) =>
  side === "right"
    ? "translate(4px, -50%)"
    : side === "left"
      ? "translate(calc(-100% - 4px), -50%)"
      : `translate(${(along - 1) * 50}%, ${side === "above" ? "calc(-100% - 4px)" : "4px"})`;

/**
 * A board's map block beside its locations, on a desktop-wide screen at least 34rem tall (`pin`, globals.css): its words
 * scroll on above, in a card of their own, and the map pins under the section bar, as wide as its column and as tall as
 * the screen leaves room for (at most 3:2), its frame widened to fill that (HeatMap). The block becomes a grid whose last
 * row runs the length of the locations, with the card's background (`bg`) painted behind rows 1 to 4. The block's card
 * and the HeatMap's wrapper step aside (`contents`) so their parts can take cells of the grid. Each part names its cell:
 * placed by the grid, the words would go beside the card's background instead of over it. None of it applies on paper.
 */
export const PINNED = {
  wrap: "lg:pin:grid lg:pin:grid-rows-[repeat(4,auto)_minmax(0,1fr)] lg:pin:self-stretch",
  card: "lg:pin:contents",
  bg: "hidden rounded-[28px] bg-background lg:pin:block lg:pin:[grid-area:1/1/5/2]",
  head: "lg:pin:[grid-area:1/1] lg:pin:px-6 lg:pin:pt-6",
  heat: "lg:pin:contents",
  caption: "lg:pin:[grid-area:2/1] lg:pin:mx-6 lg:pin:mt-4 lg:pin:mb-0",
  map: "lg:pin:[grid-area:5/1] lg:pin:sticky lg:pin:top-20 lg:pin:mt-4 lg:pin:self-start lg:pin:aspect-2/3 lg:pin:max-h-[calc(100dvh-6rem)] lg:pin:max-w-none lg:pin:[container-type:size]",
  // The drawing at its frame's shape, as large as the box holds it (the same as the box, once the frame fills it).
  layer: "lg:pin:h-[min(100%,calc(100cqw/var(--frame-aspect)))] lg:pin:w-[min(100%,calc(100cqh*var(--frame-aspect)))]",
  legend: "lg:pin:[grid-area:3/1] lg:pin:mx-6",
  note: "lg:pin:[grid-area:4/1] lg:pin:mx-6 lg:pin:mt-4 lg:pin:mb-6",
};

/**
 * A board's map held beside its locations (board.css `.loc-map`, from a laptop's width on a screen 34rem tall): only the
 * shoot-base line above it, the map filling the rest of the held column, its frame widened to fill it (HeatMap). The
 * caption, the legend and the note stay for phones and paper. None of the `lg:pin:` parts applies on paper.
 */
const HELD = {
  card: "lg:pin:h-full lg:pin:gap-3 lg:pin:p-4",
  head: "",
  heat: "lg:pin:flex lg:pin:min-h-0 lg:pin:flex-1 lg:pin:flex-col",
  caption: "hidden print:block",
  map: "lg:pin:min-h-0 lg:pin:flex-1 lg:pin:aspect-auto lg:pin:max-w-none lg:pin:[container-type:size]",
  layer: PINNED.layer,
  legend: "lg:pin:hidden",
  note: "lg:pin:hidden",
};

/** Where a board's pinned or held map fills its column: PINNED's and HELD's `lg:pin:`, and so never on paper. */
const FILL = "screen and (min-width: 64rem) and (min-height: 34rem)";

/**
 * A pinned map's box, in screen pixels, while it fills its column (PINNED.map), for the frame to fill it too: undefined
 * where the box takes the frame's own shape. Measured before the first paint, and again whenever the box changes. The
 * page prints in the state it's in, so the frame goes back to its own shape just before.
 */
function useFill(box: RefObject<HTMLDivElement | null>, on: boolean) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  useLayoutEffect(() => {
    const el = box.current;
    if (!on || !el) return;
    const media = matchMedia(FILL);
    const measure = () => {
      if (!media.matches) return setSize(undefined);
      // The drawing goes inside the border.
      const rect = el.getBoundingClientRect();
      const width = fixed(rect.width - 2 * el.clientLeft);
      const height = fixed(rect.height - 2 * el.clientTop);
      // A page Next keeps hidden after you leave it measures nothing: the last size stays for when it shows again.
      if (width <= 0 || height <= 0) return;
      setSize((now) => (now?.width === width && now.height === height ? now : { width, height }));
    };
    const paper = () => flushSync(() => setSize(undefined));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    media.addEventListener("change", measure);
    addEventListener("beforeprint", paper);
    addEventListener("afterprint", measure);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", measure);
      removeEventListener("beforeprint", paper);
      removeEventListener("afterprint", measure);
    };
  }, [box, on]);
  return size;
}

function HeatMap({
  base,
  map,
  pins,
  city,
  audience,
  mock,
  active,
  compact = false,
  pinned = false,
  held = false,
  bare = false,
}: {
  base: ShootBase;
  map: HeatGrid;
  pins: Pin[];
  city: string;
  /** Whose heatmap it is, as a phrase: "Prateek Kuhad's audience". */
  audience: string;
  mock: boolean;
  /** The location being read (0-based, as on the cards): its pin grows and shows its name. */
  active?: number;
  /** In the compact block, a board's or the homepage's: never taller than the screen leaves room for. */
  compact?: boolean;
  /** In a board's block beside its locations, which pins (PINNED). */
  pinned?: boolean;
  /** Held beside a board's locations, filling its column (HELD). */
  held?: boolean;
  /** Without its caption: the homepage's step says the same beside it. */
  bare?: boolean;
}) {
  // The frame and its lines are kept while the bounds and the box stay the same: the board draws the map again as each
  // location is read, and tracing the lines takes a few milliseconds.
  const { south, west, north, east } = frameBounds(map, pins);
  const box = useRef<HTMLDivElement>(null);
  const fill = useFill(box, pinned || held);
  const own = useMemo(() => mapFrame({ south, west, north, east }, W, SHARP), [south, west, north, east]);
  // Filling its column, the map is drawn larger, and wider or taller than the frame: the frame grows to the box's shape
  // where the grid has the heat for it (`reach`; older grids stay at their own shape, centred), and the tiles come at the
  // zoom that keeps them at least as sharp as the box is large.
  const { reach } = map;
  const f = useMemo(() => {
    if (!fill) return own;
    const bounds = { south, west, north, east };
    return mapFrame(reach ? widen(bounds, fill.width / fill.height, reach) : bounds, W, Math.max(SHARP, fill.width, fill.height));
  }, [own, fill, reach, south, west, north, east]);
  const lines = useMemo(() => heatContours(map, f, LEVELS), [map, f]);
  // The lines' colour, as `--heat`: the highlighter on screen and ink on paper, or tape pink, both places, when mocked.
  const heat = mock ? "[--heat:var(--tape)]" : "[--heat:var(--accent)] print:[--heat:var(--foreground)]";
  // Screen pixels per SVG unit, once the map is on screen: where the names fit depends on it. Filling its box, the
  // drawing is as wide as the box holds it at the frame's shape (PINNED.layer).
  const layer = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<number>();
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setDrawn(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const width = fill ? Math.min(fill.width, (fill.height * f.width) / f.height) : drawn;
  const scale = width ? width / f.width : 1;
  const at = (p: Point) => ({ left: `${(p.x / f.width) * 100}%`, top: `${(p.y / f.height) * 100}%` });
  // The chosen area is labelled first, so it gets the best spot.
  const rings = [...base.areas]
    .sort((a, b) => Number(b.ref === base.chosen) - Number(a.ref === base.chosen))
    .map((a) => ({ area: a, name: a.name, x: f.x(a.lon), y: f.y(a.lat), r: f.metres(a.radius_m, a.lat) }));
  const spots = pins.map((p) => ({ x: f.x(p.lon), y: f.y(p.lat) }));
  const placed = placePins(spots);
  const names = placeLabels(rings, placed, f.width, f.height, scale);
  const chosen = base.areas.find((a) => a.ref === base.chosen);
  const summary =
    `${mock ? "Synthetic heatmap" : "Qloo heatmap"} of ${city} for this audience, in contour lines: strongest around ${base.areas.map((a) => a.name).join(", then ")}.` +
    (chosen ? ` The shoot is based in ${chosen.name}.` : "") +
    (pins.length > 0 ? ` Locations ${pins.map((p) => p.n).join(", ")} are marked.` : "");
  // On paper, beside the locations, the map takes the left of its block and the words the right (ShootBaseBlock), so the
  // block is only as tall as the map and the first location fits under it, on US Letter too. Its width follows from its
  // height, 26rem, a little under the screen's cap.
  const paper = compact
    ? {
        wrap: "print:contents",
        caption: "print:col-start-2 print:row-start-2 print:mb-0",
        map: "print:col-start-1 print:row-span-5 print:row-start-1 print:mx-0 print:w-[calc(var(--map-height)*var(--map-ratio))] print:[--map-height:26rem]",
        legend: "print:col-start-2 print:row-start-3 print:mt-0",
      }
    : { wrap: "", caption: "", map: "", legend: "" };
  const pin = pinned ? PINNED : held ? HELD : { heat: "", caption: "", map: "", layer: "", legend: "" };

  return (
    <div className={`${heat} ${paper.wrap} ${pin.heat}`}>
      {!bare && (
        <p className={`mb-3 max-w-[60ch] text-small leading-5 text-dim ${paper.caption} ${pin.caption}`}>
          <span className="font-semibold text-foreground">Where the fans are.</span> {mock ? "A synthetic heatmap" : "Qloo's heatmap"} of{" "}
          {audience} across {city}, drawn as contour lines: the bolder the line, the stronger this audience is inside it.
        </p>
      )}
      <div
        ref={box}
        className={`relative mx-auto aspect-(--map-aspect) w-full max-w-(--map-max) overflow-hidden rounded-2xl border border-line bg-[#2b2b2b] print:bg-white ${paper.map} ${pin.map}`}
        style={
          {
            // The box takes the frame's own shape, except where it fills its column (PINNED.map).
            "--map-aspect": `${own.width} / ${own.height}`,
            // In the compact block, a phone's or the homepage's, the map stays clear of the screen's edges: the rest
            // of the block takes about 28rem.
            "--map-max": compact
              ? `calc(var(--map-height, max(16rem, min(30rem, 100dvh - 28rem))) * ${own.width / own.height})`
              : `${(34 * own.width) / own.height}rem`,
            "--map-ratio": own.width / own.height,
            "--frame-aspect": f.width / f.height,
          } as CSSProperties
        }
      >
        <div ref={layer} className={`absolute inset-0 m-auto ${pin.layer}`}>
          <StreetTiles frame={f} />
          <svg viewBox={`0 0 ${f.width} ${f.height}`} role="img" aria-label={summary} className="absolute inset-0 size-full">
            {lines.map((line, i) => (
              <Fragment key={line.level}>
                {i === lines.length - 1 && <path d={line.area} fill="var(--heat)" fillOpacity={TOP_FILL} fillRule="evenodd" />}
                <path
                  d={line.line}
                  fill="none"
                  stroke="var(--heat)"
                  strokeOpacity={LINES[i].opacity}
                  strokeWidth={LINES[i].width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </Fragment>
            ))}
            {rings.map(({ area, x, y, r }) => (
              <circle
                key={area.ref}
                cx={x}
                cy={y}
                r={r}
                fill="none"
                stroke={area.ref === base.chosen ? "var(--foreground)" : "var(--dim)"}
                strokeWidth={area.ref === base.chosen ? 2 : 1.25}
                strokeDasharray={area.ref === base.chosen ? undefined : "4 4"}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {spots.map((spot, i) => (
              <g key={i}>
                {(placed[i].x !== spot.x || placed[i].y !== spot.y) && (
                  <line
                    x1={spot.x}
                    y1={spot.y}
                    x2={placed[i].x}
                    y2={placed[i].y}
                    stroke="var(--foreground)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <circle cx={spot.x} cy={spot.y} r={2.5} fill="var(--foreground)" />
              </g>
            ))}
          </svg>
          {rings.map((ring, i) => {
            const anchor = {
              above: { x: ring.x, y: ring.y - ring.r },
              below: { x: ring.x, y: ring.y + ring.r },
              right: { x: ring.x + ring.r, y: ring.y },
              left: { x: ring.x - ring.r, y: ring.y },
            }[names[i].side];
            return (
              <span
                key={ring.area.ref}
                aria-hidden
                className={`absolute whitespace-nowrap rounded-[4px] bg-frame/85 px-1.5 py-[3px] text-label leading-none ${
                  ring.area.ref === base.chosen ? "font-bold text-foreground" : "text-dim"
                }`}
                style={{ ...at(anchor), transform: labelShift(names[i]) }}
              >
                {ring.name}
              </span>
            );
          })}
          {pins.map((p, i) => {
            const on = active !== undefined && p.n === active + 1;
            return (
              <Fragment key={p.n}>
                <span
                  aria-hidden
                  title={p.name}
                  className={`absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-bold ring-2 ring-frame ${
                    on
                      ? "z-10 size-[30px] bg-accent text-caption text-ink shadow-[0_0_0_6px_rgb(228_255_58/0.3)]"
                      : "size-[20px] bg-foreground text-label text-frame"
                  }`}
                  style={at(placed[i])}
                >
                  {p.n}
                </span>
                {on && (
                  <span
                    aria-hidden
                    className="absolute z-10 truncate rounded-md bg-(--light-background) px-1.5 py-0.5 text-label font-bold whitespace-nowrap text-ink"
                    style={{
                      ...at(placed[i]),
                      ...pinNameStyle(
                        placePinName(
                          placed[i],
                          mapName(p.name),
                          rings,
                          names,
                          placed.filter((_, j) => j !== i),
                          f.width,
                          f.height,
                          scale,
                        ),
                        (placed[i].x / f.width) * 100,
                        scale,
                      ),
                    }}
                  >
                    {mapName(p.name)}
                  </span>
                )}
              </Fragment>
            );
          })}
        </div>
        <MapCredit />
      </div>
      <div className={`mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-label leading-4 text-dim ${paper.legend} ${pin.legend}`}>
        <span className="flex items-center gap-1.5">
          Weaker
          {/* The four lines as small loops, drawn as on the map. */}
          <svg aria-hidden viewBox="0 0 70 12" className="h-3 w-[70px]">
            {LINES.map((l, i) => (
              <rect
                key={l.level}
                x={i * 18 + 1.25}
                y={1.25}
                width={13.5}
                height={9.5}
                rx={4.75}
                fill={i === LINES.length - 1 ? "var(--heat)" : "none"}
                fillOpacity={TOP_FILL}
                stroke="var(--heat)"
                strokeOpacity={l.opacity}
                strokeWidth={l.width}
              />
            ))}
          </svg>
          Stronger
        </span>
        <span>Rings: the strongest areas, {base.areas[0]?.radius_m / 1000} km around; solid is the shoot base</span>
        {pins.length > 0 && <span>Numbers: the locations {compact ? "beside the map" : "below"}</span>}
      </div>
    </div>
  );
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * On paper the block is part of the white page, lined up with the cards around it: ink type, lines and rings over grey
 * streets, with the light room's evidence and mock colours. `.surface-dark` sets its tokens outside Tailwind's layers,
 * so these must be important.
 */
const PAPER =
  "print:p-0 print:[--background:#fff]! print:[--foreground:var(--light-foreground)]! print:[--dim:var(--light-dim)]! print:[--line:var(--light-line)]! print:[--frame:#fff]! print:[--tungsten:var(--light-tungsten)]! print:[--tape:var(--light-tape)]!";

/**
 * The shoot base and its map. Takes the parts rather than a whole treatment, so the homepage can draw a featured run's
 * base exactly as its board does. With no pins (the homepage lists no locations) the numbers and their legend drop out.
 */
export function ShootBaseBlock({
  base,
  pins = [],
  city,
  audience,
  mock,
  active,
  compact = false,
  pinned = false,
  held = false,
  mapOnly = false,
}: {
  base?: ShootBase;
  /** The scouted places, numbered as on the location cards. */
  pins?: Pin[];
  city: string;
  /** Whose heatmap it is, as a phrase: "Prateek Kuhad's audience" (audiencePhrase in options.ts). */
  audience: string;
  mock: boolean;
  /** The location being read, highlighted on the map. */
  active?: number;
  /** On the homepage: the map with a short header instead of the side panel. */
  compact?: boolean;
  /** Beside a board's location cards: compact, and pinned while they scroll (PINNED; the board's wrapper takes `wrap`). */
  pinned?: boolean;
  /** Held beside a board's locations, one place to a screen (HELD; the board's `.loc-map` holds it). */
  held?: boolean;
  /** With `compact`: the map and its legend alone, for the homepage's step, whose own card names the base. */
  mapOnly?: boolean;
}) {
  const chosen = base?.areas.find((a) => a.ref === base.chosen) ?? base?.areas[0];
  if (!base || !chosen) return null;
  const others = base.areas.filter((a) => a.ref !== chosen.ref);
  const evidence = evidenceTone(mock);
  const km = `${chosen.radius_m / 1000} km`;
  const locations = pins.length > 0 ? "Every location" : "Every location in the treatment";
  const share = <span className={`rounded-md px-1.5 py-0.5 font-bold ${rankMark(mock)}`}>{percent(chosen.share)}</span>;
  const map = base.map && base.map.tiles.length > 0 && base.map;
  if (compact || pinned || held) {
    const pin = pinned ? PINNED : held ? HELD : { card: "", head: "", note: "" };
    return (
      <div
        className={`surface-dark flex flex-col gap-4 rounded-[28px] bg-background p-5 sm:p-6 print:grid print:break-inside-avoid print:grid-cols-[auto_minmax(0,1fr)] print:grid-rows-[auto_auto_auto_auto_1fr] print:items-start print:gap-x-6 print:gap-y-3 ${PAPER} ${pin.card}`}
      >
        {pinned && <div aria-hidden className={PINNED.bg} />}
        {!mapOnly && (
          <div className={`flex flex-wrap items-end justify-between gap-x-5 gap-y-2 print:col-start-2 print:row-start-1 ${pin.head}`}>
            <div>
              <p className="text-small font-semibold text-dim">Shoot base</p>
              <p className={`type-poster mt-1.5 ${held ? "text-subsection" : "text-section"}`}>{chosen.name}</p>
            </div>
            <p className="text-small leading-6">
              {share} of this audience&apos;s strongest spots in {city}
            </p>
          </div>
        )}
        {map && (
          <HeatMap
            base={base}
            map={map}
            pins={pins}
            city={city}
            audience={audience}
            mock={mock}
            active={active}
            compact
            pinned={pinned}
            held={held}
            bare={mapOnly}
          />
        )}
        {!mapOnly && (
          <p className={`text-small leading-6 text-dim print:col-start-2 print:row-start-4 ${pin.note}`}>
            {base.held
              ? `${locations} is within ${km} of ${chosen.name}, so the unit can stay in one area.`
              : `Too few places matched within ${km} of ${chosen.name}, so the locations come from across ${city}.`}
            {others.length > 0 && ` Also strong: ${others.map((a) => `${a.name} (${percent(a.share)})`).join(", ")}.`}
          </p>
        )}
      </div>
    );
  }
  return (
    <div
      className={`surface-dark mb-10 grid gap-8 rounded-[28px] bg-background p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_17rem] print:break-inside-avoid ${PAPER}`}
    >
      {map ? (
        <HeatMap base={base} map={map} pins={pins} city={city} audience={audience} mock={mock} />
      ) : (
        <p className="text-small leading-5 text-dim">The heatmap itself didn&apos;t come back with this treatment.</p>
      )}
      <div>
        <p className="text-small font-semibold text-dim">Shoot base</p>
        <p className="type-poster mt-2 text-display-sm">{chosen.name}</p>
        {chosen.district && <p className="mt-2 text-ui text-dim">{chosen.district}</p>}
        <p className="mt-4 text-ui leading-6">
          {share} of this audience&apos;s strongest spots in {city}
        </p>
        <p className="mt-3 text-small leading-6 text-dim">
          {base.held
            ? `${mock ? "The mock's" : "Qloo's"} heatmap puts this audience here. Every location below is within ${km}, so the unit can stay in one area.`
            : `Too few places matched within ${km} of ${chosen.name}, so the locations below come from across ${city}.`}
        </p>
        {chosen.near.length > 0 && <p className="mt-3 text-label leading-5 text-dim">Around it: {chosen.near.join(", ")}.</p>}
        {others.length > 0 && (
          <div className="mt-6">
            <p className="text-caption font-medium text-dim">Other strong areas</p>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {others.map((a) => (
                <li key={a.ref} className="flex items-baseline justify-between gap-3 py-2 text-small leading-5">
                  <span>
                    {a.name}
                    {a.district && <span className="text-dim">, {a.district}</span>}
                  </span>
                  <span className={`type-evidence text-label leading-4 ${evidence}`}>{percent(a.share)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
