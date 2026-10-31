"use client";

import Link from "next/link";
import { useState } from "react";
import { tmdbSize, type Format } from "@/lib/agent/options";
import type { ShowFrame } from "../home/data";
import { CutLink } from "../home/cut-link";
import { useArrivals } from "../home/ending";
import "../home/home.css";
import { useLingo } from "../studio/lingo";
import { Still } from "../studio/parts";
import { titleFont, titleStyle } from "../studio/title-fonts";

const FILTERS: { id: "all" | Format; label: string }[] = [
  { id: "all", label: "All" },
  { id: "music_video", label: "Music videos" },
  { id: "short_film", label: "Short films" },
];

const card = "rv press flex h-full flex-col overflow-hidden rounded-[26px] border border-line bg-card [--press:0.985] hover:border-edge";

/** The examples as cards, with a filter by format when there are both; the last card is the one still to be made. */
export function ExampleGrid({ frames }: { frames: ShowFrame[] }) {
  const { t } = useLingo();
  const [filter, setFilter] = useState<"all" | Format>("all");
  const root = useArrivals<HTMLDivElement>();
  const both = new Set(frames.map((f) => f.format)).size > 1;
  const shown = frames.filter((f) => filter === "all" || f.format === filter);
  return (
    <div ref={root} className="flex flex-col gap-7 sm:gap-11">
      {both && (
        <div role="group" aria-label="Show" className="inline-flex flex-wrap gap-1 self-start rounded-3xl border border-line bg-card p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`min-h-10 rounded-full px-4 text-small font-semibold transition-colors ${
                filter === f.id ? "bg-foreground text-background" : "hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,21rem),1fr))] gap-4 sm:gap-6">
        {shown.map((frame) => (
          <li key={frame.slug}>
            <CutLink href={`/t/${frame.slug}`} className={`ex-card ${card}`}>
              <span className="relative block aspect-video overflow-hidden bg-frame">
                {frame.still && <Still src={tmdbSize(frame.still, "w780")} alt="" className="size-full object-cover" />}
              </span>
              <span className="flex flex-1 flex-col gap-2.5 px-5 pt-4.5 pb-5">
                <span className="text-small font-semibold text-faint">{frame.meta}</span>
                <span className="leading-[1.02] text-balance" style={titleStyle(titleFont(frame.fontId), "var(--text-subsection)")}>
                  {frame.title}
                </span>
                <span className="ex-log font-serif text-lead leading-[1.35] text-dim">{frame.logline}</span>
                {frame.tones.length > 0 && (
                  <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {frame.tones.map((tone) => (
                      <span
                        key={tone.name}
                        className={`inline-flex min-h-7 items-center rounded-full border px-3 text-caption font-semibold ${
                          tone.shared ? "border-accent bg-accent text-ink" : "border-line bg-field"
                        }`}
                      >
                        {tone.name}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span
                aria-hidden
                className="grid h-2.5"
                style={{ gridTemplateColumns: `repeat(${Math.max(1, frame.palette.length)}, minmax(0, 1fr))` }}
              >
                {frame.palette.map((hex) => (
                  <i key={hex} style={{ background: hex }} />
                ))}
              </span>
            </CutLink>
          </li>
        ))}
        <li>
          <Link
            href="/studio"
            className={`${card} min-h-70 items-center justify-center gap-2 border-dashed bg-field p-7 text-center`}
            aria-label={`${t.nextUp.title}: start a treatment`}
          >
            <span className="text-ui text-dim">{t.nextUp.label}</span>
            <span className="type-poster text-display-sm">{t.nextUp.title}</span>
            <span className="text-ui text-dim">An artist or a film, and a city.</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
