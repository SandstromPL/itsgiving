import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ShootBase, Treatment } from "@/lib/agent/types";
import type { HeatGrid } from "@/lib/tools/heatmap";
import { heatContours } from "./contours";
import { MapCredit, StreetTiles, fixed, mapFrame, type Bounds } from "./street-map";

// The shoot base: Qloo's heatmap around the strongest areas for this audience, as contour lines on the city's streets,
// with the areas as rings, the one the planner chose, and the scouted locations as numbered pins. Lines, rings and
// leader lines are SVG and scale with the map; names and numbers are HTML on top, so they stay legible at any width.
// One drawing everywhere: a treatment's board and the homepage's "How it works" both use ShootBaseBlock.

/** The frame's longer side in SVG units; about a pixel each on a desktop screen. */
const W = 600;
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

/**
 * Each area's name beside its ring, on the first side that stays in the frame and clear of the pins and the
 * names placed before it. Names are HTML at a fixed size, so in SVG units they grow as the map shrinks: `scale` is
 * screen pixels per SVG unit (1 before the map is measured).
 */
export function placeLabels(
  rings: { name: string; x: number; y: number; r: number }[],
  pins: Point[],
  width: number,
  height: number,
  scale = 1,
): Side[] {
  const px = (n: number) => n / scale;
  const taken: Box[] = pins.map((p) => ({ left: p.x - px(10), top: p.y - px(10), right: p.x + px(10), bottom: p.y + px(10) }));
  return rings.map((ring) => {
    const w = px(ring.name.length * 6.6 + 10);
    const h = px(18);
    const gap = px(4);
    const boxes: Record<Side, Box> = {
      above: { left: ring.x - w / 2, right: ring.x + w / 2, top: ring.y - ring.r - gap - h, bottom: ring.y - ring.r - gap },
      below: { left: ring.x - w / 2, right: ring.x + w / 2, top: ring.y + ring.r + gap, bottom: ring.y + ring.r + gap + h },
      right: { left: ring.x + ring.r + gap, right: ring.x + ring.r + gap + w, top: ring.y - h / 2, bottom: ring.y + h / 2 },
      left: { left: ring.x - ring.r - gap - w, right: ring.x - ring.r - gap, top: ring.y - h / 2, bottom: ring.y + h / 2 },
    };
    const fits = (b: Box) =>
      b.left >= 0 &&
      b.right <= width &&
      b.top >= 0 &&
      b.bottom <= height &&
      !taken.some((t) => b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top);
    const side = (["above", "below", "right", "left"] as const).find((s) => fits(boxes[s])) ?? "above";
    taken.push(boxes[side]);
    return side;
  });
}

const LABEL_SHIFT: Record<Side, string> = {
  above: "translate(-50%, calc(-100% - 4px))",
  below: "translate(-50%, 4px)",
  right: "translate(4px, -50%)",
  left: "translate(calc(-100% - 4px), -50%)",
};

function HeatMap({
  base,
  map,
  pins,
  city,
  audience,
  mock,
  active,
  compact = false,
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
  /** Pinned beside the locations: never taller than the screen leaves room for. */
  compact?: boolean;
}) {
  // The frame and its lines are kept while the bounds stay the same: the board draws the map again as each location is
  // read, and tracing the lines takes a few milliseconds.
  const { south, west, north, east } = frameBounds(map, pins);
  const f = useMemo(() => mapFrame({ south, west, north, east }, W), [south, west, north, east]);
  const lines = useMemo(() => heatContours(map, f, LEVELS), [map, f]);
  // The lines' colour, as `--heat`: the highlighter on screen and ink on paper, or tape pink, both places, when mocked.
  const heat = mock ? "[--heat:var(--tape)]" : "[--heat:var(--accent)] print:[--heat:var(--foreground)]";
  // Screen pixels per SVG unit, once the map is on screen: where the names fit depends on it.
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setScale(el.clientWidth / f.width || 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [f.width]);
  const at = (p: Point) => ({ left: `${(p.x / f.width) * 100}%`, top: `${(p.y / f.height) * 100}%` });
  // The chosen area is labelled first, so it gets the best spot.
  const rings = [...base.areas]
    .sort((a, b) => Number(b.ref === base.chosen) - Number(a.ref === base.chosen))
    .map((a) => ({ area: a, name: a.name, x: f.x(a.lon), y: f.y(a.lat), r: f.metres(a.radius_m, a.lat) }));
  const spots = pins.map((p) => ({ x: f.x(p.lon), y: f.y(p.lat) }));
  const placed = placePins(spots);
  const sides = placeLabels(rings, placed, f.width, f.height, scale);
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

  return (
    <div className={`${heat} ${paper.wrap}`}>
      <p className={`mb-3 max-w-[60ch] text-[14px] leading-5 text-dim ${paper.caption}`}>
        <span className="font-semibold text-foreground">Where the fans are.</span> {mock ? "A synthetic heatmap" : "Qloo's heatmap"} of{" "}
        {audience} across {city}, drawn as contour lines: the bolder the line, the stronger this audience is inside it.
      </p>
      <div
        ref={box}
        className={`relative mx-auto w-full overflow-hidden rounded-2xl border border-line bg-[#2b2b2b] print:bg-white ${paper.map}`}
        style={
          {
            aspectRatio: `${f.width} / ${f.height}`,
            // Pinned beside the locations, the whole block must fit under the section bar: the rest of it (caption,
            // legend, the base's panel) and the 5rem offset take about 26rem, measured at 1280x720 and 1440x900.
            maxWidth: compact
              ? `calc(var(--map-height, max(16rem, min(30rem, 100dvh - 28rem))) * ${f.width / f.height})`
              : `${(34 * f.width) / f.height}rem`,
            "--map-ratio": f.width / f.height,
          } as CSSProperties
        }
      >
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
          }[sides[i]];
          return (
            <span
              key={ring.area.ref}
              aria-hidden
              className={`absolute whitespace-nowrap rounded-[4px] bg-frame/85 px-1.5 py-[3px] text-[12px] leading-none ${
                ring.area.ref === base.chosen ? "font-bold text-foreground" : "text-dim"
              }`}
              style={{ ...at(anchor), transform: LABEL_SHIFT[sides[i]] }}
            >
              {ring.name}
            </span>
          );
        })}
        {pins.map((p, i) => {
          const on = active !== undefined && p.n === active + 1;
          // The name goes on the pin's roomier side, and a long one is cut short there rather than by the frame.
          const x = (placed[i].x / f.width) * 100;
          const left = x > 50;
          return (
            <Fragment key={p.n}>
              <span
                aria-hidden
                title={p.name}
                className={`absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full font-bold ring-2 ring-frame ${
                  on
                    ? "z-10 size-[30px] bg-accent text-[13px] text-[#121211] shadow-[0_0_0_6px_rgb(228_255_58/0.3)]"
                    : "size-[20px] bg-foreground text-[11px] text-frame"
                }`}
                style={at(placed[i])}
              >
                {p.n}
              </span>
              {on && (
                <span
                  aria-hidden
                  className="absolute z-10 truncate rounded-md bg-[#f2f0ea] px-1.5 py-0.5 text-[12px] font-bold whitespace-nowrap text-[#121211]"
                  style={{
                    ...at(placed[i]),
                    transform: left ? "translate(calc(-100% - 20px), -50%)" : "translate(20px, -50%)",
                    maxWidth: `calc(${fixed(left ? x : 100 - x)}% - 28px)`,
                  }}
                >
                  {p.name}
                </span>
              )}
            </Fragment>
          );
        })}
        <MapCredit />
      </div>
      <div className={`mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-dim ${paper.legend}`}>
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
  /** Beside the location cards, or on the homepage: the map with a short header instead of the side panel. */
  compact?: boolean;
}) {
  const chosen = base?.areas.find((a) => a.ref === base.chosen) ?? base?.areas[0];
  if (!base || !chosen) return null;
  const others = base.areas.filter((a) => a.ref !== chosen.ref);
  const evidence = mock ? "text-tape" : "text-tungsten";
  const km = `${chosen.radius_m / 1000} km`;
  const locations = pins.length > 0 ? "Every location" : "Every location in the treatment";
  const share = (
    <span className={`rounded-md px-1.5 py-0.5 font-bold text-[#121211] ${mock ? "bg-[#ffd6ea]" : "bg-accent"}`}>
      {percent(chosen.share)}
    </span>
  );
  const map = base.map && base.map.tiles.length > 0 && base.map;
  if (compact) {
    return (
      <div
        className={`surface-dark flex flex-col gap-4 rounded-[28px] bg-background p-5 sm:p-6 print:grid print:break-inside-avoid print:grid-cols-[auto_minmax(0,1fr)] print:grid-rows-[auto_auto_auto_auto_1fr] print:items-start print:gap-x-6 print:gap-y-3 ${PAPER}`}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 print:col-start-2 print:row-start-1">
          <div>
            <h4 className="text-[14px] font-semibold text-dim">Shoot base</h4>
            <p className="type-poster mt-1.5 text-[clamp(2rem,3.2vw,2.75rem)]">{chosen.name}</p>
          </div>
          <p className="text-[14px] leading-6">
            {share} of this audience&apos;s strongest spots in {city}
          </p>
        </div>
        {map && <HeatMap base={base} map={map} pins={pins} city={city} audience={audience} mock={mock} active={active} compact />}
        <p className="text-sm leading-6 text-dim print:col-start-2 print:row-start-4">
          {base.held
            ? `${locations} is within ${km} of ${chosen.name}, so the unit can stay in one area.`
            : `Too few places matched within ${km} of ${chosen.name}, so the locations come from across ${city}.`}
          {others.length > 0 && ` Also strong: ${others.map((a) => `${a.name} (${percent(a.share)})`).join(", ")}.`}
        </p>
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
        <p className="text-sm text-dim">The heatmap itself didn&apos;t come back with this treatment.</p>
      )}
      <div>
        <h4 className="text-[14px] font-semibold text-dim">Shoot base</h4>
        <p className="type-poster mt-2 text-[clamp(2.4rem,4vw,3.25rem)]">{chosen.name}</p>
        {chosen.district && <p className="mt-2 text-[15px] text-dim">{chosen.district}</p>}
        <p className="mt-4 text-[15px] leading-6">
          {share} of this audience&apos;s strongest spots in {city}
        </p>
        <p className="mt-3 text-sm leading-6 text-dim">
          {base.held
            ? `${mock ? "The mock's" : "Qloo's"} heatmap puts this audience here. Every location below is within ${km}, so the unit can stay in one area.`
            : `Too few places matched within ${km} of ${chosen.name}, so the locations below come from across ${city}.`}
        </p>
        {chosen.near.length > 0 && <p className="mt-3 text-xs leading-5 text-dim">Around it: {chosen.near.join(", ")}.</p>}
        {others.length > 0 && (
          <div className="mt-6">
            <h5 className="text-[13px] font-medium text-dim">Other strong areas</h5>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {others.map((a) => (
                <li key={a.ref} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span>
                    {a.name}
                    {a.district && <span className="text-dim">, {a.district}</span>}
                  </span>
                  <span className={`type-evidence text-xs ${evidence}`}>{percent(a.share)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
