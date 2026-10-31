"use client";

import { Fragment, useEffect, useRef, useState, type AnimationEvent, type CSSProperties, type Ref, type RefObject } from "react";
import { BUDGETS, FORMATS, joinNames, treatmentSubject, treatmentWho } from "@/lib/agent/options";
import type { Treatment } from "@/lib/agent/types";
import { useCopied } from "./clipboard";
import { EraLayer } from "./era-layer";
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
  /** The film tradition's look the cover wears, if any (eras.ts). */
  era: EraPick;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const take = `${t.id}-${t.createdAt}`;
  const rack = useRackFocus(take, title);
  const who = treatmentWho(t);
  const subject = treatmentSubject(t);
  const words = t.title.split(/\s+/).filter(Boolean);
  return (
    // In the page at about 2.11:1 (the screen's width less the page's gutters), and taller when its words need it: a
    // fixed ratio would cut a long title off.
    <header
      ref={ref}
      key={take}
      className="surface-dark relative isolate flex min-h-[32rem] flex-col justify-between gap-10 overflow-hidden rounded-[2rem] p-6 sm:p-10 md:min-h-[max(27.5rem,calc((min(100vw,80rem)-4rem)/2.11))] print:min-h-[225mm]"
      style={{ background: darkOf(t.palette.map((c) => c.hex)) }}
    >
      {/* A reference film's still, never its poster (or a mock placeholder): their own lettering would fight the title. */}
      <div aria-hidden className="absolute inset-0 -z-10">
        {still && <Still src={still.src} alt="" loading="eager" className="absolute inset-0 size-full" />}
      </div>
      {/* The pills up top sit on the frame itself, so each brings its own dark: AA over a white frame. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[19px] border border-edge bg-black/70 px-3.5 py-2 text-small text-dim">
            {FORMATS[t.brief.format]} {subject}, {t.brief.city}, {BUDGETS[t.brief.budget].label.toLowerCase()} budget
          </span>
          {who.standIns.length > 0 && (
            <span
              title={`Qloo doesn't have ${who.artists[0] ?? "the artist"}, so this audience stands in.`}
              className="rounded-[19px] border border-edge bg-black/70 px-3.5 py-2 text-small text-dim"
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
      <div className="scrim-under flex flex-col gap-6 [--scrim-b:1.5rem] [--scrim-x:1.5rem] sm:[--scrim-b:2.5rem] sm:[--scrim-x:2.5rem]">
        {/* 1B rack focus: the first time a take opens, its title sharpens word by word (board.css). */}
        <h1
          ref={title}
          id="treatment-title"
          tabIndex={-1}
          onAnimationEnd={rack.onAnimationEnd}
          className={`${rack.className} max-w-[16ch] text-balance`}
          style={titleStyle(titleFont(fontId))}
        >
          {words.map((word, i) => (
            <Fragment key={i}>
              {i > 0 && " "}
              <span className="rack-w" data-last={i === words.length - 1 ? "" : undefined} style={{ "--i": i } as CSSProperties}>
                {word}
              </span>
            </Fragment>
          ))}
        </h1>
        <p className="max-w-[40ch] font-serif text-logline leading-[1.2] text-pretty italic">{t.logline}</p>
        <CoverPalette palette={t.palette} />
      </div>
    </header>
  );
}

/**
 * The title's rack focus (board.css), once per take. Next only hides a page you leave, and showing it again on Back or
 * Forward would restart a CSS animation, so the class comes off once the last word has landed. A new take in the studio
 * racks again.
 */
function useRackFocus(take: string, title: RefObject<HTMLElement | null>) {
  const [racked, setRacked] = useState<string | null>(null);
  // A short rack (reduced motion's fade), or a page slow to come to life, can finish before anything listens for its
  // end: then the class comes off as soon as the page is live.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const anims = title.current?.getAnimations({ subtree: true }) ?? [];
      if (!anims.some((a) => a instanceof CSSAnimation && a.animationName.startsWith("rack"))) setRacked(take);
    });
    return () => cancelAnimationFrame(frame);
  }, [take, title]);
  return {
    className: racked === take ? "" : "rack",
    onAnimationEnd: (event: AnimationEvent) => {
      if ((event.target as HTMLElement).dataset.last !== undefined) setRacked(take);
    },
  };
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
              className="flex cursor-pointer items-center gap-2 rounded-full bg-black/40 py-1.5 pr-3.5 pl-1.5 text-caption hover:bg-black/60"
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

/**
 * The palette, each colour a button that copies its hex, which colourists paste straight into a grade or a deck. A
 * swatch lifts as a pointer passes over it (board.css); a phone gets three to a row.
 */
export function PaletteSwatches({ palette }: { palette: Treatment["palette"] }) {
  const { copied, copy } = useCopied();
  return (
    <>
      <ul
        className="grid grid-cols-3 gap-3 sm:grid-cols-[repeat(var(--n),minmax(0,1fr))] sm:gap-4"
        style={{ "--n": Math.min(palette.length, 8) } as CSSProperties}
      >
        {palette.map((c) => (
          <li key={c.hex} className="rv">
            <button
              type="button"
              aria-label={`Copy ${c.name}, ${c.hex}`}
              onClick={() => copy(c.hex)}
              className="swatch-btn block w-full cursor-pointer rounded-[20px] text-left [--press:0.98]"
            >
              <span
                aria-hidden
                className="swatch block aspect-[4/5] w-full rounded-[20px] ring-1 ring-black/10 print:aspect-[3/2]"
                style={{ background: c.hex }}
              />
              <span className="mt-3 block text-ui leading-tight font-semibold">{c.name}</span>
              <span className="flex items-center gap-1 font-mono text-caption text-faint">
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
