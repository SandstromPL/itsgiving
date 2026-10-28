"use client";

import { useLayoutEffect, useRef, type Ref } from "react";
import { BUDGETS, FORMATS, joinNames, treatmentSubject, treatmentWho } from "@/lib/agent/options";
import type { Treatment } from "@/lib/agent/types";
import { useCopied } from "./clipboard";
import { EraLayer } from "./era-layer";
import { useLetterbox } from "./letterbox";
import { landCover } from "./morph";
import { darkOf } from "./color";
import { Still, Tape } from "./parts";
import { TitleCardPicker, type CoverStill, type EraPick } from "./title-card";
import { titleFont, titleStyle } from "./title-fonts";
import { CheckIcon } from "./icons";

// The treatment's cover: the still with its title, logline and line, the era it wears, and the palette strip; and the
// palette's swatches, which copy their colour. Split from board.tsx, which lays the sections out.

export function Cover({
  ref,
  t,
  still,
  fontId,
  suggestion,
  onPickFont,
  stills,
  onPickStill,
  morph,
  era,
}: {
  ref?: Ref<HTMLElement>;
  t: Treatment;
  /** The cover's still: the reference the director picked in the title-card window, or the writer's (coverReference). */
  still?: CoverStill;
  fontId: string;
  suggestion: { id: string; why: string };
  onPickFont: (id: string) => void;
  /** The references with a still, to choose among. */
  stills: CoverStill[];
  onPickStill: (id: string) => void;
  /** On an example's own page, its slug: a homepage poster's still may grow into this cover (morph.ts). */
  morph?: string;
  /** The film tradition's look the cover wears, if any (eras.ts). */
  era: EraPick;
}) {
  const stillLayer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (morph) landCover(morph, stillLayer.current?.parentElement ?? null, stillLayer.current);
  }, [morph]);
  const take = `${t.id}-${t.createdAt}`;
  const letterbox = useLetterbox(take);
  const who = treatmentWho(t);
  const subject = treatmentSubject(t);
  return (
    <header
      ref={ref}
      key={take}
      onAnimationEnd={letterbox.onAnimationEnd}
      className={`${letterbox.className} surface-dark relative isolate flex min-h-[32rem] flex-col justify-between gap-10 overflow-hidden rounded-[2rem] p-6 sm:min-h-[36rem] sm:p-10 print:min-h-[225mm]`}
      style={{ background: darkOf(t.palette.map((c) => c.hex)) }}
    >
      {/* A reference film's still, never its poster (or a mock placeholder): their own lettering would fight the title. */}
      <div ref={stillLayer} aria-hidden className="absolute inset-0 -z-10">
        {still && <Still src={still.src} alt="" loading="eager" className="absolute inset-0 size-full" />}
      </div>
      {/* The pills up top sit on the frame itself, so each brings its own dark: AA over a white frame. */}
      <div data-morph="top" className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[19px] border border-edge bg-black/70 px-3.5 py-2 text-[14px] text-dim">
            {FORMATS[t.brief.format]} {subject}, {t.brief.city}, {BUDGETS[t.brief.budget].label.toLowerCase()} budget
          </span>
          {who.standIns.length > 0 && (
            <span
              title={`Qloo doesn't have ${who.artists[0] ?? "the artist"}, so this audience stands in.`}
              className="rounded-[19px] border border-edge bg-black/70 px-3.5 py-2 text-[14px] text-dim"
            >
              Audience read through {joinNames(who.standIns)}
            </span>
          )}
          {t.mock.qloo && <Tape title="Synthetic fixtures with real names; every score is invented. Not Qloo data.">Mock data</Tape>}
        </div>
        <TitleCardPicker
          title={t.title}
          fontId={fontId}
          suggestion={suggestion}
          onPick={onPickFont}
          stills={stills}
          stillId={still?.id}
          onPickStill={onPickStill}
          era={era}
        />
      </div>
      <EraLayer id={era.id} title={t.title} play={era.moment} />
      <div
        data-morph="words"
        className="scrim-under flex flex-col gap-6 [--scrim-b:1.5rem] [--scrim-x:1.5rem] sm:[--scrim-b:2.5rem] sm:[--scrim-x:2.5rem]"
      >
        <h1 id="treatment-title" tabIndex={-1} className="max-w-[16ch] text-balance" style={titleStyle(titleFont(fontId))}>
          {t.title}
        </h1>
        <p className="max-w-[40ch] font-serif text-[clamp(1.4rem,2.4vw,1.9rem)] leading-[1.2] text-pretty italic">{t.logline}</p>
        <CoverPalette palette={t.palette} />
      </div>
    </header>
  );
}

const check = <CheckIcon size={13} />;

/** The cover's colours, each a chip that copies its hex: "Copied" sits over the name, so the row doesn't shift. */
function CoverPalette({ palette }: { palette: Treatment["palette"] }) {
  const { copied, copy } = useCopied();
  return (
    <>
      <ul aria-label="Palette" className="flex flex-wrap gap-2">
        {palette.map((c) => (
          <li key={c.hex}>
            <button
              type="button"
              title={c.hex}
              aria-label={`Copy ${c.name}, ${c.hex}`}
              onClick={() => copy(c.hex)}
              className="flex cursor-pointer items-center gap-2 rounded-full bg-black/40 py-1.5 pr-3.5 pl-1.5 text-[13px] hover:bg-black/60"
            >
              <span aria-hidden className="size-[22px] rounded-full ring-1 ring-white/25" style={{ background: c.hex }} />
              <span className="relative whitespace-nowrap">
                <span className={copied === c.hex ? "invisible" : undefined}>{c.name}</span>
                {copied === c.hex && <span className="absolute inset-y-0 left-0 flex items-center gap-1">{check}Copied</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {copied ? `Copied ${copied}` : ""}
      </p>
    </>
  );
}

/** The palette, each colour a button that copies its hex, which colourists paste straight into a grade or a deck. */
export function PaletteSwatches({ palette }: { palette: Treatment["palette"] }) {
  const { copied, copy } = useCopied();
  return (
    <>
      <ul className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {palette.map((c) => (
          <li key={c.hex}>
            <button
              type="button"
              aria-label={`Copy ${c.name}, ${c.hex}`}
              onClick={() => copy(c.hex)}
              className="block w-full cursor-pointer rounded-[20px] text-left [--press:0.98]"
            >
              <span
                aria-hidden
                className="block aspect-[4/5] w-full rounded-[20px] ring-1 ring-black/10 print:aspect-[3/2]"
                style={{ background: c.hex }}
              />
              <span className="mt-2 block text-[15px] leading-tight font-semibold">{c.name}</span>
              <span className="flex items-center gap-1 font-mono text-[13px] text-faint">
                {copied === c.hex ? (
                  <>
                    {check}
                    Copied
                  </>
                ) : (
                  c.hex
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p role="status" className="sr-only">
        {copied ? `Copied ${copied}` : ""}
      </p>
    </>
  );
}
