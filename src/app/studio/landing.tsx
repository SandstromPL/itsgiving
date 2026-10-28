"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";
import type { FeaturedCover, FeaturedRun } from "@/lib/agent/featured";
import { STEP_LABELS, tmdbSize } from "@/lib/agent/options";
import { ShootBaseBlock } from "./base-map";
import { darkOf } from "./color";
import { evidenceTone, primaryButton, rankMark, secondaryButton, slip } from "./ui";
import { briefLine, splitTitles, type FormState } from "./form";
import { useLingo } from "./lingo";
import { morphToCover } from "./morph";
import { Receipt, Still } from "./parts";
import { suggestTitleFontFrom, titleFont, titleStyle } from "./title-fonts";

// The homepage, the pitch: what itsgiving is, finished treatments to open, and one real run explained. No form here;
// the tool has its own page (/studio), and every featured treatment has its own (/t/<slug>).

const posterTitle = "text-[clamp(1.6rem,2.3vw,2.15rem)] leading-[0.92] font-extrabold tracking-[-0.045em] text-balance";
/** A poster's place in "Now showing": most of a phone's width in the sideways row, a grid cell from small screens up. */
const poster = "w-[78%] shrink-0 snap-start sm:w-auto";

/**
 * What a link to an example page needs for the match cut: the still to name, the full page prefetched (with Partial
 * Prefetching the default fetches only the page's shell, so the board couldn't render in the navigation's own commit),
 * and the navigation started inside the view transition.
 */
function useMorphLink(slug: string) {
  const router = useRouter();
  const still = useRef<HTMLSpanElement>(null);
  const onNavigate = (event: { preventDefault(): void }) => morphToCover(event, slug, still.current, () => router.push(`/t/${slug}`));
  return [still, onNavigate] as const;
}

/**
 * A finished treatment's cover, opening like a letterbox on load: the page's one moment of motion. Qloo's receipt for
 * the film its still comes from is pinned to its corner, so the first screen carries proof, not only the pitch. On a
 * phone the cover is a letterboxed strip with the title alone, and the receipt one line under it.
 */
function HeroCover({ cover, fontId, className = "" }: { cover: FeaturedCover; fontId: string; className?: string }) {
  const proof = cover.evidence;
  const [still, onNavigate] = useMorphLink(cover.slug);
  return (
    <div className={`relative ${className}`}>
      <Link
        href={`/t/${cover.slug}`}
        prefetch
        onNavigate={onNavigate}
        aria-label={`${cover.title}: open this finished treatment`}
        className="letterbox-open surface-dark relative isolate flex aspect-[2.39/1] flex-col justify-between gap-2 overflow-hidden rounded-[2rem] p-4 [--hero-title:2.1rem] sm:aspect-auto sm:min-h-[27rem] sm:gap-8 sm:p-8 sm:[--hero-title:clamp(2.6rem,4.6vw,4.5rem)]"
        style={{ background: darkOf(cover.palette) }}
      >
        <span ref={still} aria-hidden className="absolute inset-0 -z-10">
          {cover.still && <Still src={cover.still} alt="" className="absolute inset-0 size-full" />}
        </span>
        <span className="self-start rounded-[19px] border border-edge bg-black/70 px-3 py-1 text-[12.5px] text-dim sm:px-3.5 sm:py-2 sm:text-[14px]">
          {cover.line}
        </span>
        {/* The still shows at full strength; the words bring their own dark (scrim-under). */}
        <span className="scrim-under flex flex-col gap-4 [--scrim-b:1rem] [--scrim-fade:3rem] [--scrim-x:1rem] sm:[--scrim-b:2rem] sm:[--scrim-fade:6rem] sm:[--scrim-x:2rem]">
          <span className="max-w-[14ch] text-balance" style={titleStyle(titleFont(fontId), "var(--hero-title)")}>
            {cover.title}
          </span>
          <span className="hidden max-w-[38ch] font-serif text-[clamp(1.2rem,1.8vw,1.5rem)] leading-[1.25] text-pretty italic sm:block">
            {cover.logline}
          </span>
          <span aria-hidden className="hidden gap-1.5 sm:flex">
            {cover.palette.map((hex) => (
              <span key={hex} className="size-5 rounded-full ring-1 ring-white/25" style={{ background: hex }} />
            ))}
          </span>
        </span>
      </Link>
      {proof && (
        <>
          <Receipt
            qloo={proof.qloo}
            mock={proof.mock}
            label={`the still: ${proof.name}`}
            className="absolute right-[-0.75rem] bottom-[-5rem] hidden w-[17rem] rotate-2 shadow-[4px_4px_0_rgb(0_0_0/0.12)] sm:block"
          />
          <p
            data-receipt={proof.mock ? "mock" : "qloo"}
            className={`mt-3 rounded-xl border border-dashed px-3 py-2 font-mono text-[12.5px] leading-[1.6] sm:hidden ${slip(proof.mock)}`}
          >
            {proof.mock ? "Mock receipt, not Qloo" : "Qloo receipt"}: {proof.name}, the still, ranks{" "}
            <span className={`px-1 ${rankMark(proof.mock)}`}>
              {proof.qloo.rank} of {proof.qloo.of}
            </span>{" "}
            for this audience
          </p>
        </>
      )}
    </div>
  );
}

export function Hero({ cover, fontId }: { cover?: FeaturedCover; fontId?: string }) {
  return (
    <section className="mx-auto grid w-full max-w-[80rem] items-center gap-5 px-4 pt-8 pb-16 sm:gap-12 sm:px-8 sm:pt-14 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* On a phone the column opens up (`contents`) so the cover can sit between the headline and the paragraph: the
          first screen then holds a finished treatment and its receipt as well as the pitch. */}
      <div className="contents sm:flex sm:flex-col sm:gap-7">
        <span className="order-1 -rotate-3 self-start justify-self-start rounded-xl bg-accent px-3.5 py-2 text-[15px] font-bold text-[#121211]">
          for music-video and short-film directors
        </span>
        <h1 className="order-2 type-poster text-[3.9rem] sm:text-[clamp(4.25rem,8vw,7.5rem)]">
          your voice,
          <br />
          their taste.
        </h1>
        <p className="order-4 max-w-[34ch] text-[1.15rem] leading-[1.45] text-dim sm:text-[1.3rem]">
          Give it an artist, or the films your short is after, and a city. It reads what that audience actually loves on Qloo and writes a
          treatment you can pitch, with receipts for every pick.
        </p>
        <div className="order-5 flex flex-wrap gap-3">
          <Link href="/studio" className={primaryButton}>
            Start a treatment
          </Link>
          {cover && (
            <Link href={`/t/${cover.slug}`} prefetch className={`${secondaryButton} max-sm:hidden`}>
              See a finished one
            </Link>
          )}
        </div>
        <p className="order-6 text-[15px] text-faint">No sign-up to build. A live build takes about 40 seconds.</p>
      </div>
      {cover && fontId && <HeroCover cover={cover} fontId={fontId} className="order-3" />}
    </section>
  );
}

/**
 * "Now showing": the featured treatments as posters, each a link to its own page, in a dark strip whichever room the
 * reader chose, and last the poster for the one they haven't made yet, a way into the studio. The homepage leaves out
 * the treatment its hero already shows. The projector's beam (`.beam` in globals.css) is simply on.
 */
/** A "Now showing" poster: its still grows into the example's cover when it opens (morph.ts). */
function PosterCard({ cover }: { cover: FeaturedCover }) {
  const { t, unc } = useLingo();
  const [still, onNavigate] = useMorphLink(cover.slug);
  return (
    <Link
      href={`/t/${cover.slug}`}
      prefetch
      onNavigate={onNavigate}
      className="press flex w-full flex-col overflow-hidden rounded-[26px] ring-1 ring-white/10 transition-transform duration-200 [--press:0.98] hover:-translate-y-1"
      style={{ background: darkOf(cover.palette) }}
    >
      <span className="relative isolate flex aspect-[4/5] w-full flex-col justify-end p-5">
        <span ref={still} aria-hidden className="absolute inset-0 -z-10">
          {cover.still && <Still src={tmdbSize(cover.still, "w780")} alt="" className="absolute inset-0 size-full" />}
        </span>
        <span className="scrim-under flex flex-col gap-3.5 [--scrim-b:1.25rem] [--scrim-fade:4rem] [--scrim-x:1.25rem]">
          {cover.tone && (
            <span className="self-start rounded-xl bg-accent px-3 py-1.5 text-[15px] font-bold text-[#121211]">
              {unc ? `${t.giving}: ${cover.tone}` : `${t.giving} ${cover.tone.toLowerCase()}`}
            </span>
          )}
          <span className={posterTitle}>{cover.title}</span>
          <span className="text-[15px] text-pretty text-dim">{cover.line}</span>
        </span>
      </span>
      <span aria-hidden className="grid h-3 w-full" style={{ gridTemplateColumns: `repeat(${cover.palette.length}, minmax(0, 1fr))` }}>
        {cover.palette.map((hex) => (
          <span key={hex} style={{ background: hex }} />
        ))}
      </span>
    </Link>
  );
}

/** `live`: the server has its keys, so no covers means the build made none, not that it couldn't. */
export function NowShowing({ covers, live = false }: { covers: FeaturedCover[]; live?: boolean }) {
  const { t, unc } = useLingo();
  // Without featured treatments, the header's Examples link still needs somewhere to land, and the page says why.
  if (covers.length === 0) {
    return (
      <section id="now-showing" aria-labelledby="featured-heading" className="mx-auto w-full max-w-[80rem] px-4 py-12 sm:px-8">
        <div className="flex flex-col gap-3 rounded-[28px] border border-line bg-card p-8">
          <h2 id="featured-heading" className="type-head text-[clamp(1.75rem,3vw,2.25rem)] leading-none">
            {t.nowShowing}
          </h2>
          <p className="max-w-[60ch] text-[1.05rem] leading-[1.55] text-dim">
            {live
              ? "Featured treatments are built from live Qloo data when the site is deployed, and this deploy hasn't built them yet. The studio still builds treatments."
              : "Featured treatments are built from live Qloo data when the site is deployed with its keys, and this server has none. The studio still builds treatments."}
          </p>
        </div>
      </section>
    );
  }
  return (
    <section id="now-showing" aria-labelledby="featured-heading" className="surface-dark relative isolate bg-background">
      <span aria-hidden className="beam print:hidden" />
      <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-8 px-4 py-16 sm:px-8 sm:py-24">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="featured-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
            {t.nowShowing}
          </h2>
          <p className="text-[16px] text-dim">Built from live Qloo data. Each one opens at once.</p>
        </div>
        {/* On a phone the posters sit in a row that scrolls sideways, the next one peeking in, rather than four screens
            of posters one under another. */}
        {/* A sideways swipe past the last poster stays in the row, rather than becoming the browser's Back. */}
        <ul className="quiet-scroll -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto overscroll-x-contain px-4 pt-1 pb-3 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] sm:gap-5 sm:overflow-visible sm:p-0">
          {covers.map((cover) => (
            <li key={cover.slug} className={poster}>
              <PosterCard cover={cover} />
            </li>
          ))}
          <li className={poster}>
            <Link
              href="/studio"
              aria-label={`${t.nextUp.title}: start a treatment`}
              className="press flex w-full flex-col overflow-hidden rounded-[26px] bg-frame transition-transform duration-200 [--press:0.98] [outline:2px_dashed_var(--accent)] [outline-offset:-10px] hover:-translate-y-1"
            >
              <span className="flex aspect-[4/5] w-full flex-col justify-between gap-3.5 p-5">
                <span className="font-mono text-[12px] text-dim">{t.nextUp.label}</span>
                <span className="flex flex-col gap-3">
                  <span className="self-start rounded-xl bg-accent px-3 py-1.5 text-[15px] font-bold text-[#121211]">
                    {unc ? `${t.giving}: ?` : `${t.giving}… ?`}
                  </span>
                  <span className={posterTitle}>{t.nextUp.title}</span>
                  <span className="text-[15px] text-dim">Your artist or film, your city</span>
                </span>
              </span>
              <span aria-hidden className="h-3 w-full bg-[#2a2926]" />
            </Link>
          </li>
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
  // A music video is named for its artist; a short film for the films it's after.
  const title = isVideo ? who || "your artist here" : after.length > 0 ? `after ${after[0]}` : "your short here";
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
          <span className={`${posterTitle} ${(isVideo ? who : after.length > 0) ? "text-foreground" : "text-faint"}`}>{title}</span>
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
  const evidence = evidenceTone(run.mock);
  const steps: { title: string; text: string; show: ReactNode }[] = [
    {
      title: STEP_LABELS.audience,
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
      title: STEP_LABELS.heatmap,
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
              className={`rounded-xl border border-dashed px-4 py-3 font-mono text-[13px] leading-[1.65] tabular-nums ${slip(run.mock)}`}
            >
              <p className="font-semibold">
                {r.kind}: {r.name}
              </p>
              <p>
                <span className={`px-1 ${rankMark(run.mock)}`}>
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
      title: STEP_LABELS.write,
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
  [STEP_LABELS.audience, "Qloo shows what the audience of an artist or a film over-indexes on, and where it meets your own taste."],
  [STEP_LABELS.heatmap, "A heatmap of the city picks the neighbourhood to base the shoot in."],
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
          Make one for your next video or short.
        </h2>
        <p className="text-[1.1rem] text-dim">An artist or a film, and a city, are enough to start.</p>
      </div>
      <Link href="/studio" className={primaryButton}>
        Start a treatment
      </Link>
    </section>
  );
}
