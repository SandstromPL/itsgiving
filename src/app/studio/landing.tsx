"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { FeaturedCover, FeaturedRun } from "@/lib/agent/featured";
import { ShootBaseBlock } from "./base-map";
import { briefLine, splitTitles, type FormState } from "./form";
import { useLingo } from "./lingo";
import { Still } from "./parts";
import { suggestTitleFontFrom, titleFont, titleStyle } from "./title-fonts";

// The homepage, the pitch: what itsgiving is, finished treatments to open, and one real run explained. No form here;
// the tool has its own page (/studio), and every featured treatment has its own (/t/<slug>).

/** The darkest of a palette, mixed toward ink so white type always holds on it. */
export function darkOf(palette: string[]): string {
  const luminance = (hex: string) => {
    const n = Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  const darkest = [...palette].sort((a, b) => luminance(a) - luminance(b))[0] ?? "#121211";
  return `color-mix(in srgb, ${darkest} 55%, #121211)`;
}

export const primaryButton =
  "inline-flex min-h-14 items-center justify-center rounded-full bg-foreground px-7 text-[17px] font-bold text-background hover:opacity-90";
export const secondaryButton =
  "inline-flex min-h-14 items-center justify-center rounded-full border border-foreground px-7 text-[17px] font-bold hover:bg-card";

const posterTitle = "text-[clamp(1.6rem,2.3vw,2.15rem)] leading-[0.92] font-extrabold tracking-[-0.045em] text-balance";

/** A finished treatment's cover, opening like a letterbox on load: the page's one moment of motion. */
function HeroCover({ cover, fontId }: { cover: FeaturedCover; fontId: string }) {
  return (
    <Link
      href={`/t/${cover.slug}`}
      aria-label={`${cover.title}: open this finished treatment`}
      className="letterbox-open surface-dark grain relative isolate flex min-h-[22rem] flex-col justify-between gap-8 overflow-hidden rounded-[2rem] p-6 sm:min-h-[27rem] sm:p-8"
      style={{ background: darkOf(cover.palette) }}
    >
      <span aria-hidden className="absolute inset-0 -z-10">
        {cover.still && <Still src={cover.still} alt="" className="absolute inset-0 size-full opacity-55" />}
        <span className="absolute inset-0 bg-[linear-gradient(0deg,rgb(10_9_8/0.9)_0%,rgb(10_9_8/0.3)_58%,rgb(10_9_8/0.55)_100%)]" />
      </span>
      <span className="self-start rounded-full border border-edge px-3.5 py-2 text-[14px] text-dim">{cover.line}</span>
      <span className="flex flex-col gap-4">
        <span className="max-w-[14ch] text-balance" style={titleStyle(titleFont(fontId), "clamp(2.6rem, 4.6vw, 4.5rem)")}>
          {cover.title}
        </span>
        <span className="max-w-[38ch] font-serif text-[clamp(1.2rem,1.8vw,1.5rem)] leading-[1.25] text-pretty italic">{cover.logline}</span>
        <span aria-hidden className="flex gap-1.5">
          {cover.palette.map((hex) => (
            <span key={hex} className="size-5 rounded-full ring-1 ring-white/25" style={{ background: hex }} />
          ))}
        </span>
      </span>
    </Link>
  );
}

export function Hero({ cover, fontId }: { cover?: FeaturedCover; fontId?: string }) {
  return (
    <section className="mx-auto grid w-full max-w-[80rem] items-center gap-12 px-4 pt-10 pb-16 sm:px-8 sm:pt-14 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col gap-7">
        <span className="-rotate-3 self-start rounded-xl bg-accent px-3.5 py-2 text-[15px] font-bold text-[#121211]">
          for music-video and short-film directors
        </span>
        <h1 className="type-poster text-[clamp(4.25rem,8vw,7.5rem)]">
          your voice,
          <br />
          their taste.
        </h1>
        <p className="max-w-[34ch] text-[1.3rem] leading-[1.45] text-dim">
          Give it an artist and a city. It reads what the fans actually love on Qloo and writes a treatment you can pitch, with receipts for
          every pick.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/studio" className={primaryButton}>
            Start a treatment
          </Link>
          {cover && (
            <Link href={`/t/${cover.slug}`} className={secondaryButton}>
              See a finished one
            </Link>
          )}
        </div>
        <p className="text-[15px] text-faint">No sign-up. A live build takes about 40 seconds.</p>
      </div>
      {cover && fontId && <HeroCover cover={cover} fontId={fontId} />}
    </section>
  );
}

/**
 * "Now showing": the featured treatments as posters, each a link to its own page, in a dark strip whichever room the
 * reader chose. The projector's beam (`.beam` in globals.css) fades in once, the first time the strip comes into view.
 */
export function NowShowing({ covers }: { covers: FeaturedCover[] }) {
  const { t, unc } = useLingo();
  const strip = useRef<HTMLElement>(null);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setLit(true);
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (covers.length === 0) return null;
  return (
    <section id="now-showing" ref={strip} aria-labelledby="featured-heading" className="surface-dark grain relative isolate bg-background">
      <span aria-hidden data-on={lit || undefined} className="beam print:hidden" />
      <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-8 px-4 py-16 sm:px-8 sm:py-24">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="featured-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
            {t.nowShowing}
          </h2>
          <p className="text-[16px] text-dim">Built from live Qloo data. Each one opens at once.</p>
        </div>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-5">
          {covers.map((cover) => (
            <li key={cover.slug}>
              <Link
                href={`/t/${cover.slug}`}
                className="flex w-full flex-col overflow-hidden rounded-[26px] ring-1 ring-white/10 transition-transform duration-200 hover:-translate-y-1"
                style={{ background: darkOf(cover.palette) }}
              >
                <span className="relative isolate flex aspect-[4/5] w-full flex-col justify-end gap-3.5 p-5">
                  {cover.still && <Still src={cover.still} alt="" className="absolute inset-0 -z-10 size-full opacity-60" />}
                  <span
                    aria-hidden
                    className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgb(10_9_8/0.88)_0%,rgb(10_9_8/0.25)_62%,rgb(10_9_8/0.45)_100%)]"
                  />
                  {cover.tone && (
                    <span className="self-start rounded-xl bg-accent px-3 py-1.5 text-[15px] font-bold text-[#121211]">
                      {unc ? `${t.giving}: ${cover.tone}` : `${t.giving} ${cover.tone.toLowerCase()}`}
                    </span>
                  )}
                  <span className={posterTitle}>{cover.title}</span>
                  <span className="text-[15px] text-dim">{cover.line}</span>
                </span>
                <span
                  aria-hidden
                  className="grid h-3 w-full"
                  style={{ gridTemplateColumns: `repeat(${cover.palette.length}, minmax(0, 1fr))` }}
                >
                  {cover.palette.map((hex) => (
                    <span key={hex} style={{ background: hex }} />
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The brief as a poster before it is built: the artist (or the films a short is after) and the city, filled in as the
 * director types, beside the studio's form. It repeats the form, so screen readers skip it.
 */
export function YourPoster({ form }: { form: FormState }) {
  const { t, unc } = useLingo();
  const isVideo = form.format === "music_video";
  const who = form.artist.trim();
  const after = splitTitles(form.touchstones);
  const title = who || (isVideo ? "your artist here" : after.length > 0 ? `after ${after[0]}` : "your short here");
  return (
    <div
      aria-hidden
      className="surface-dark flex flex-col overflow-hidden rounded-[26px] bg-frame [outline:2px_dashed_var(--accent)] [outline-offset:-10px]"
    >
      <span className="flex aspect-[4/5] w-full flex-col justify-between gap-3.5 p-5">
        <span className="font-mono text-[12px] text-dim">{t.yourPoster}</span>
        <span className="flex flex-col gap-3">
          <span className="self-start rounded-xl bg-accent px-3 py-1.5 text-[15px] font-bold text-[#121211]">
            {unc ? `${t.giving}: ?` : `${t.giving}… ?`}
          </span>
          <span className={`${posterTitle} ${who || after.length > 0 ? "text-foreground" : "text-faint"}`}>{title}</span>
          <span className="text-[15px] text-dim">{briefLine(form)}</span>
        </span>
      </span>
      <span className="h-3 w-full bg-[#2a2926]" />
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * "How it works": one real featured run, step by step, each step beside what it produced: the audience Qloo read, the
 * shoot base on its map (drawn as on the treatment's board), the receipts, the title. Still: nothing pins or plays.
 */
export function HowItWorks({ run }: { run: FeaturedRun }) {
  const { t } = useLingo();
  const chosen = run.base.areas.find((a) => a.ref === run.base.chosen) ?? run.base.areas[0];
  const font = titleFont(suggestTitleFontFrom({ mock: run.mock, city: run.city, base: chosen?.name, tags: run.tags }).id);
  const evidence = run.mock ? "text-tape" : "text-tungsten";
  const steps: { title: string; text: string; show: ReactNode }[] = [
    {
      title: "Read the fans",
      text: `Qloo reads what ${run.subject}'s audience over-indexes on: moods, genres, and the age and gender it leans to. It describes a group, never one person.`,
      show: (
        <div className="flex flex-col gap-3.5 rounded-[26px] border border-line bg-card p-6">
          <p className="text-[14px] font-semibold text-dim">{capitalize(run.audience)}</p>
          <ul className="flex flex-wrap gap-2">
            {run.tones.map((tone) => (
              <li
                key={tone.name}
                className={
                  tone.shared
                    ? "rounded-full bg-accent px-4 py-2 text-[16px] font-bold text-[#121211]"
                    : "rounded-full border border-line bg-field px-4 py-2 text-[16px]"
                }
              >
                {tone.name}
              </li>
            ))}
          </ul>
          {run.leans && <p className={`type-evidence text-[13px] ${evidence}`}>{run.leans}</p>}
        </div>
      ),
    },
    {
      title: "Find where they are",
      text: `A heatmap of ${run.city} shows where those fans cluster. The strongest area becomes the shoot base, so the locations stay close together and the crew moves less.`,
      show: <ShootBaseBlock base={run.base} city={run.city} audience={run.audience} mock={run.mock} compact />,
    },
    {
      title: "Bring receipts",
      text: "Films, wardrobe brands and places, each ranked for this audience. The rank and the affinity are Qloo's, not the model's.",
      show: (
        <ul className="flex flex-col gap-2.5">
          {run.receipts.map((r) => (
            <li
              key={r.kind}
              className="rounded-xl border border-dashed border-slip-edge bg-slip px-4 py-3 font-mono text-[13px] leading-[1.65] text-[#2b2925] tabular-nums"
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
      ),
    },
    {
      title: "Write it",
      text: `${run.writtenBy} writes the treatment around that evidence: ${run.qlooCalls} Qloo calls and ${run.modelCalls} model calls.`,
      show: (
        <Link href={`/t/${run.slug}`} className="surface-dark grain flex flex-col gap-4 rounded-[26px] bg-background p-6 sm:p-8">
          <span className="text-balance" style={titleStyle(font, "clamp(2.25rem, 3.6vw, 3.5rem)")}>
            {run.title}
          </span>
          <span className="max-w-[40ch] font-serif text-[1.3rem] leading-snug text-pretty italic text-dim">{run.logline}</span>
          <span className="text-[15px] font-semibold underline decoration-edge underline-offset-4">Read the whole treatment</span>
        </Link>
      ),
    },
  ];
  return (
    <section aria-labelledby="how-heading" className="mx-auto flex w-full max-w-[80rem] flex-col gap-14 px-4 py-20 sm:px-8 sm:py-28">
      <div className="flex max-w-[46rem] flex-col gap-3">
        <h2 id="how-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
          {t.watchItWork}
        </h2>
        <p className="text-[1.15rem] leading-[1.5] text-dim">
          One real run, step by step: {run.subject} in {run.city}.
        </p>
      </div>
      <ol className="flex flex-col gap-16 sm:gap-20">
        {steps.map((step, i) => (
          <li key={step.title} className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
            {/* The words stay beside a tall map while it scrolls past: plain sticky, the scroll stays the reader's. */}
            <div className="flex flex-col gap-2.5 lg:sticky lg:top-10 lg:pt-3">
              <span className="text-[15px] font-semibold text-faint">
                Step {i + 1} of {steps.length}
              </span>
              <h3 className="type-head text-[clamp(1.75rem,2.6vw,2.25rem)] leading-tight">{step.title}</h3>
              <p className="max-w-[38ch] text-[1.15rem] leading-[1.5] text-dim">{step.text}</p>
            </div>
            <div className="min-w-0">{step.show}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const STEPS = [
  ["Read the fans", "Qloo shows what the artist's audience over-indexes on, and where it meets your own taste."],
  ["Find where they are", "A heatmap of the city picks the neighbourhood to base the shoot in."],
  ["Plan and write", "The model turns that evidence into a concept, beats, wardrobe and locations."],
  ["Bring receipts", "Every film, brand and place shows why Qloo picked it, kept apart from the writing."],
] as const;

/** The steps in words, for a server without a featured run to show (mock mode). */
export function HowItWorksSteps() {
  const { t } = useLingo();
  return (
    <section aria-labelledby="how-heading" className="mx-auto flex w-full max-w-[80rem] flex-col gap-6 px-4 py-16 sm:px-8">
      <h2 id="how-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
        {t.watchItWork}
      </h2>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="flex flex-col gap-2.5 rounded-[22px] border border-line bg-card p-5">
            <span className="text-[15px] font-semibold text-faint">Step {i + 1}</span>
            <span className="type-head text-[1.4rem] leading-tight">{title}</span>
            <span className="text-[16px] leading-6 text-dim">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The closing call, for whoever read this far: at the end of the homepage and of a featured treatment. */
export function StartYourOwn() {
  return (
    <section
      aria-labelledby="start-heading"
      className="flex flex-col items-start gap-6 rounded-[2rem] border border-line bg-card p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10 print:hidden"
    >
      <div className="flex flex-col gap-2">
        <h2 id="start-heading" className="type-head text-[clamp(1.9rem,3vw,2.5rem)] leading-tight">
          Make one for your artist.
        </h2>
        <p className="text-[1.1rem] text-dim">An artist and a city are enough to start.</p>
      </div>
      <Link href="/studio" className={primaryButton}>
        Start a treatment
      </Link>
    </section>
  );
}
