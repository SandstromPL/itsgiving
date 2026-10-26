"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FeaturedReplay } from "@/lib/agent/featured";
import { heatAlpha } from "./base-map";
import { useLingo } from "./lingo";
import { MapCredit, StreetTiles, mapFrame } from "./street-map";
import { suggestTitleFontFrom, titleFont, titleStyle } from "./title-fonts";

// "Watch it work": one real featured run replayed as the visitor scrolls. A stage stays pinned beside five steps and
// builds up as each step crosses the middle of the screen: the audience, the city's heatmap, the base, the receipts,
// the title. Narrow screens get the finished stage above a plain list, since there is no room to pin it.

const WIDE = "(min-width: 64rem)";

function useWide(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** The city's streets with the audience's heat on them, as on a treatment's map, and the areas once picked. */
function ReplayMap({ replay, pins }: { replay: FeaturedReplay; pins: boolean }) {
  const { bounds, cell, tiles } = replay.map;
  const f = mapFrame(bounds, 300, 300);
  const { width, height } = f;
  const tone = replay.mock ? "var(--tape)" : "var(--accent)";
  return (
    <div className="relative mx-auto w-full max-w-[18rem] rounded-xl bg-[#2b2b2b]" style={{ aspectRatio: `${width} / ${height}` }}>
      <StreetTiles frame={f} />
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden className="absolute inset-0 size-full">
        {tiles.map((tile, i) => {
          const left = f.x(tile.lon - cell.lon / 2);
          const right = f.x(tile.lon + cell.lon / 2);
          const top = f.y(tile.lat + cell.lat / 2);
          const bottom = f.y(tile.lat - cell.lat / 2);
          const gap = (right - left) * 0.08;
          return heatAlpha(tile.heat) > 0 ? (
            <rect
              key={i}
              x={left + gap}
              y={top + gap}
              width={right - left - 2 * gap}
              height={bottom - top - 2 * gap}
              rx={(right - left) * 0.14}
              fill={tone}
              fillOpacity={heatAlpha(tile.heat)}
            />
          ) : null;
        })}
      </svg>
      {replay.areas.map((area) => (
        <span
          key={area.name}
          aria-hidden
          className={`absolute flex -translate-x-[7px] -translate-y-1/2 items-center gap-1.5 whitespace-nowrap transition-opacity duration-500 ${pins ? "opacity-100" : "opacity-0"}`}
          style={{ left: `${(f.x(area.lon) / width) * 100}%`, top: `${(f.y(area.lat) / height) * 100}%` }}
        >
          <span
            className={
              area.chosen
                ? "size-3.5 rounded-full border-2 border-[#121211] bg-accent shadow-[0_0_0_3px_var(--accent)]"
                : "size-2 rounded-full bg-foreground"
            }
          />
          <span
            className={
              area.chosen
                ? "rounded-md bg-[#f2f0ea] px-1.5 py-0.5 text-[12px] font-bold text-[#121211]"
                : "rounded bg-frame/85 px-1 text-[11px] text-dim"
            }
          >
            {area.name} {percent(area.share)}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The pinned frame: what each step adds stays faint until the reader reaches it. */
function Stage({ replay, step }: { replay: FeaturedReplay; step: number }) {
  const seen = (n: number) => (step >= n ? "opacity-100" : "opacity-[0.12]");
  const font = titleFont(suggestTitleFontFrom({ mock: replay.mock, city: replay.city, base: replay.areas[0]?.name, tags: replay.tags }).id);
  return (
    <div className="surface-dark grain flex h-full flex-col gap-6 rounded-[2rem] border border-line bg-background p-6 sm:p-8">
      <div className={`flex flex-col gap-2.5 transition-opacity duration-500 ${seen(1)}`}>
        <p className="font-mono text-[12px] text-dim">{replay.subject}&apos;s audience</p>
        <ul className="flex flex-wrap gap-1.5">
          {replay.tones.map((tone, i) => (
            <li
              key={tone.name}
              className={
                i === 0
                  ? "rounded-full bg-accent px-3 py-1.5 text-[14px] font-bold text-[#121211]"
                  : "rounded-full border border-line bg-card px-3 py-1.5 text-[14px]"
              }
            >
              {tone.name}
            </li>
          ))}
        </ul>
        {replay.leans && <p className="type-evidence text-[13px] text-tungsten">{replay.leans}</p>}
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-5 sm:grid-cols-2">
        <div className={`flex flex-col gap-2 transition-opacity duration-500 ${seen(2)}`}>
          <p className="font-mono text-[12px] text-dim">where the fans are in {replay.city}</p>
          <ReplayMap replay={replay} pins={step >= 3} />
          <span className="mx-auto flex w-full max-w-[18rem] justify-end">
            <MapCredit under />
          </span>
        </div>
        <ul
          className={`flex flex-col gap-2.5 transition duration-500 ${step >= 4 ? "translate-y-0 opacity-100" : "translate-y-3 opacity-[0.12]"}`}
        >
          {replay.receipts.map((r) => (
            <li
              key={r.kind}
              className="rounded-xl border border-dashed border-[#c9c1af] bg-[#fffdf6] px-3 py-2.5 font-mono text-[12px] leading-[1.6] text-[#2b2925] tabular-nums"
            >
              <p className="font-semibold">
                {r.kind}: {r.name}
              </p>
              <p>
                <span className="bg-accent px-1 text-[#121211]">
                  rank {r.rank} of {r.of}
                </span>{" "}
                for this audience
              </p>
              {r.affinity !== undefined && <p>affinity {r.affinity.toFixed(3)}</p>}
              {r.km !== undefined && <p>{r.km} km from the base</p>}
            </li>
          ))}
        </ul>
      </div>

      <div
        className={`flex origin-bottom-left flex-col gap-2 transition duration-500 ${step >= 5 ? "scale-100 opacity-100" : "scale-[0.97] opacity-[0.12]"}`}
      >
        <p className="text-balance" style={titleStyle(font, "clamp(2.25rem, 3.6vw, 3.5rem)")}>
          {replay.title}
        </p>
        <p className="font-mono text-[12px] text-dim">
          {replay.qlooCalls} Qloo calls. Written by {replay.writtenBy}.
        </p>
      </div>
    </div>
  );
}

function stepsOf(r: FeaturedReplay): [string, string][] {
  const base = r.areas[0];
  return [
    [
      "Read the fans",
      `Qloo reads what ${r.subject}'s audience over-indexes on: moods, genres, and the age and gender it leans to. It describes a group, never one person.`,
    ],
    ["Find where they are", `A heatmap of ${r.city} shows where those fans cluster, one tile at a time.`],
    [
      "Pick a base",
      r.held
        ? `${base.name} holds ${percent(base.share)} of their strongest spots, so every location stays within ${r.radiusKm} km and the crew moves less.`
        : `${base.name} holds ${percent(base.share)} of their strongest spots. Too few places matched there, so the locations come from across ${r.city}.`,
    ],
    [
      "Bring receipts",
      "Films, wardrobe brands and places, each ranked for this audience. The rank and the affinity are Qloo's, not the model's.",
    ],
    ["Write it", `${r.writtenBy} writes the treatment around that evidence: ${r.qlooCalls} Qloo calls and ${r.modelCalls} model calls.`],
  ];
}

export function Replay({ replay }: { replay: FeaturedReplay }) {
  const { t } = useLingo();
  const wide = useWide();
  const [step, setStep] = useState(1);
  const items = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (!wide) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setStep(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      // A step counts once it crosses the middle of the screen.
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const el of items.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [wide]);

  const active = wide ? step : 5;
  const steps = stepsOf(replay);
  return (
    <section aria-labelledby="replay-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="replay-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
          {t.watchItWork}
        </h2>
        <p className="text-[16px] text-faint">
          One real run: {replay.subject} in {replay.city}
          {wide ? ", replayed as you scroll" : ""}.
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-12">
        <div className="lg:sticky lg:top-16 lg:h-[min(46rem,calc(100dvh-7rem))] lg:self-start">
          <Stage replay={replay} step={active} />
        </div>
        <ol className="flex flex-col">
          {steps.map(([title, text], i) => (
            <li
              key={title}
              ref={(el) => {
                items.current[i] = el;
              }}
              data-step={i + 1}
              className={`flex flex-col gap-2.5 py-5 lg:justify-center lg:py-0 ${i === steps.length - 1 ? "lg:min-h-[50vh]" : "lg:min-h-[62vh]"}`}
            >
              <span className="font-mono text-[13px] text-faint">
                {i + 1} of {steps.length}
              </span>
              <h3
                className={`type-head text-[clamp(1.75rem,2.6vw,2.25rem)] leading-tight transition-colors duration-300 ${
                  !wide || active === i + 1 ? "text-foreground" : "text-faint"
                }`}
              >
                {title}
              </h3>
              <p className="max-w-[34ch] text-[1.15rem] leading-[1.5] text-dim">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
