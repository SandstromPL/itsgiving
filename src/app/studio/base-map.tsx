import { Fragment } from "react";
import type { ShootBase, Treatment } from "@/lib/agent/types";
import type { HeatGrid } from "@/lib/tools/heatmap";

// The shoot base: Qloo's heatmap around the strongest areas for this audience, the areas as rings, the one
// the planner chose, and the scouted locations as numbered pins. Squares, rings and leader lines are SVG and
// scale with the map; names and numbers are HTML on top, so they stay legible at any width.

/** The frame's longer side in SVG units; about a pixel each on a desktop screen. */
const W = 600;
const METRES_PER_DEGREE = 111_320;
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

/** Faint for the city's shape, bright where the audience is strongest. */
const opacity = (heat: number) => 0.07 + 0.93 * heat ** 1.5;

/** An equirectangular frame (fine at city scale) on the grid's bounds, grown to keep every pin inside. */
function frame(map: HeatGrid, pins: Pin[]) {
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
  const kx = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const scale = W / Math.max((east - west) * kx, north - south);
  return {
    width: (east - west) * kx * scale,
    height: (north - south) * scale,
    x: (lon: number) => (lon - west) * kx * scale,
    y: (lat: number) => (north - lat) * scale,
    size: (degreesLat: number) => degreesLat * scale,
  };
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
      const options = Array.from({ length: 8 }, (_, k) => ({
        x: spot.x + Math.cos((k * Math.PI) / 4 - Math.PI / 2) * PIN_GAP * ring,
        y: spot.y + Math.sin((k * Math.PI) / 4 - Math.PI / 2) * PIN_GAP * ring,
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
 * names placed before it. Sizes are estimates in SVG units (about a pixel each at desktop width).
 */
function placeLabels(rings: { name: string; x: number; y: number; r: number }[], pins: Point[], width: number, height: number): Side[] {
  const taken: Box[] = pins.map((p) => ({ left: p.x - 10, top: p.y - 10, right: p.x + 10, bottom: p.y + 10 }));
  return rings.map((ring) => {
    const w = ring.name.length * 6.6 + 10;
    const h = 18;
    const boxes: Record<Side, Box> = {
      above: { left: ring.x - w / 2, right: ring.x + w / 2, top: ring.y - ring.r - 4 - h, bottom: ring.y - ring.r - 4 },
      below: { left: ring.x - w / 2, right: ring.x + w / 2, top: ring.y + ring.r + 4, bottom: ring.y + ring.r + 4 + h },
      right: { left: ring.x + ring.r + 4, right: ring.x + ring.r + 4 + w, top: ring.y - h / 2, bottom: ring.y + h / 2 },
      left: { left: ring.x - ring.r - 4 - w, right: ring.x - ring.r - 4, top: ring.y - h / 2, bottom: ring.y + h / 2 },
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
  mock,
  active,
  compact = false,
}: {
  base: ShootBase;
  map: HeatGrid;
  pins: Pin[];
  city: string;
  mock: boolean;
  /** The location being read (0-based, as on the cards): its pin grows and shows its name. */
  active?: number;
  /** Pinned beside the locations: never taller than the screen leaves room for. */
  compact?: boolean;
}) {
  const f = frame(map, pins);
  const tone = mock ? "var(--tape)" : "var(--accent)";
  const square = f.size(map.cell.lat);
  const gap = square * 0.09;
  const at = (p: Point) => ({ left: `${(p.x / f.width) * 100}%`, top: `${(p.y / f.height) * 100}%` });
  // The chosen area is labelled first, so it gets the best spot.
  const rings = [...base.areas]
    .sort((a, b) => Number(b.ref === base.chosen) - Number(a.ref === base.chosen))
    .map((a) => ({ area: a, name: a.name, x: f.x(a.lon), y: f.y(a.lat), r: f.size(a.radius_m / METRES_PER_DEGREE) }));
  const spots = pins.map((p) => ({ x: f.x(p.lon), y: f.y(p.lat) }));
  const placed = placePins(spots);
  const sides = placeLabels(rings, placed, f.width, f.height);
  const chosen = base.areas.find((a) => a.ref === base.chosen);
  const summary =
    `${mock ? "Synthetic heatmap" : "Qloo heatmap"} of ${city} for this audience: strongest around ${base.areas.map((a) => a.name).join(", then ")}.` +
    (chosen ? ` The shoot is based in ${chosen.name}.` : "") +
    (pins.length > 0 ? ` Locations ${pins.map((p) => p.n).join(", ")} are marked.` : "");

  return (
    <div>
      <div
        className="relative mx-auto w-full overflow-hidden rounded-2xl border border-line bg-card"
        style={{
          aspectRatio: `${f.width} / ${f.height}`,
          maxWidth: compact ? `calc(min(30rem, 100dvh - 24rem) * ${f.width / f.height})` : `${(34 * f.width) / f.height}rem`,
        }}
      >
        <svg viewBox={`0 0 ${f.width} ${f.height}`} role="img" aria-label={summary} className="absolute inset-0 size-full">
          {map.tiles.map((tile, i) => (
            <rect
              key={i}
              x={f.x(tile.lon) - square / 2 + gap}
              y={f.y(tile.lat) - square / 2 + gap}
              width={square - 2 * gap}
              height={square - 2 * gap}
              rx={square * 0.16}
              fill={tone}
              fillOpacity={opacity(tile.heat)}
            />
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
          // The name goes on whichever side of the pin has room.
          const left = placed[i].x / f.width > 0.62;
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
                  className="absolute z-10 rounded-md bg-[#f2f0ea] px-1.5 py-0.5 text-[12px] font-bold whitespace-nowrap text-[#121211]"
                  style={{ ...at(placed[i]), transform: left ? "translate(calc(-100% - 20px), -50%)" : "translate(20px, -50%)" }}
                >
                  {p.name}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-dim">
        <span className="flex items-center gap-1.5">
          Weaker
          <span aria-hidden className="flex gap-0.5">
            {[0.15, 0.35, 0.6, 0.8, 1].map((heat) => (
              <span key={heat} className="size-2.5 rounded-[2px]" style={{ background: tone, opacity: opacity(heat) }} />
            ))}
          </span>
          Stronger
        </span>
        <span>Rings: {base.areas[0]?.radius_m / 1000} km shoot bases; solid is the one chosen</span>
        {pins.length > 0 && <span>Numbers: the locations {compact ? "beside the map" : "below"}</span>}
      </div>
    </div>
  );
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

export function ShootBaseBlock({
  t,
  mock,
  active,
  compact = false,
}: {
  t: Treatment;
  mock: boolean;
  /** The location being read, highlighted on the map. */
  active?: number;
  /** Pinned beside the location cards: the map with a short header instead of the side panel. */
  compact?: boolean;
}) {
  const base = t.base;
  const chosen = base?.areas.find((a) => a.ref === base.chosen) ?? base?.areas[0];
  if (!base || !chosen) return null;
  const pins = locationPins(t);
  const others = base.areas.filter((a) => a.ref !== chosen.ref);
  const evidence = mock ? "text-tape" : "text-tungsten";
  const km = `${chosen.radius_m / 1000} km`;
  const share = (
    <span className={`rounded-md px-1.5 py-0.5 font-bold text-[#121211] ${mock ? "bg-[#ffd6ea]" : "bg-accent"}`}>
      {percent(chosen.share)}
    </span>
  );
  if (compact) {
    return (
      <div className="surface-dark flex flex-col gap-4 rounded-[28px] bg-background p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
          <div>
            <h4 className="text-[14px] font-semibold text-dim">Shoot base</h4>
            <p className="type-poster mt-1.5 text-[clamp(2rem,3.2vw,2.75rem)]">{chosen.name}</p>
          </div>
          <p className="text-[14px] leading-6">
            {share} of this audience&apos;s strongest spots in {t.brief.city}
          </p>
        </div>
        {base.map && base.map.tiles.length > 0 && (
          <HeatMap base={base} map={base.map} pins={pins} city={t.brief.city} mock={mock} active={active} compact />
        )}
        <p className="text-sm leading-6 text-dim">
          {base.held
            ? `Every location is within ${km} of ${chosen.name}, so the unit can stay in one area.`
            : `Too few places matched within ${km} of ${chosen.name}, so the locations come from across ${t.brief.city}.`}
          {others.length > 0 && ` Also strong: ${others.map((a) => `${a.name} (${percent(a.share)})`).join(", ")}.`}
        </p>
      </div>
    );
  }
  return (
    <div className="surface-dark mb-10 grid gap-8 rounded-[28px] bg-background p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_17rem]">
      {base.map && base.map.tiles.length > 0 ? (
        <HeatMap base={base} map={base.map} pins={pins} city={t.brief.city} mock={mock} />
      ) : (
        <p className="text-sm text-dim">The heatmap itself didn&apos;t come back with this treatment.</p>
      )}
      <div>
        <h4 className="text-[14px] font-semibold text-dim">Shoot base</h4>
        <p className="type-poster mt-2 text-[clamp(2.4rem,4vw,3.25rem)]">{chosen.name}</p>
        {chosen.district && <p className="mt-2 text-[15px] text-dim">{chosen.district}</p>}
        <p className="mt-4 text-[15px] leading-6">
          {share} of this audience&apos;s strongest spots in {t.brief.city}
        </p>
        <p className="mt-3 text-sm leading-6 text-dim">
          {base.held
            ? `${mock ? "The mock's" : "Qloo's"} heatmap puts this audience here. Every location below is within ${km}, so the unit can stay in one area.`
            : `Too few places matched within ${km} of ${chosen.name}, so the locations below come from across ${t.brief.city}.`}
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
