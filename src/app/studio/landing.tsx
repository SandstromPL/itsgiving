"use client";

import type { Ref } from "react";
import type { Example } from "@/lib/agent/examples";
import type { FeaturedCover } from "@/lib/agent/featured";
import { splitTitles, type FormState } from "./form";
import { useLingo } from "./lingo";
import { Still } from "./parts";

/** The darkest of a palette, mixed toward ink so white type always holds on it. */
export function darkOf(palette: string[]): string {
  const luminance = (hex: string) => {
    const n = Number.parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  const darkest = [...palette].sort((a, b) => luminance(a) - luminance(b))[0] ?? "#121211";
  return `color-mix(in srgb, ${darkest} 55%, #121211)`;
}

const WHAT = ["Reference films", "Wardrobe", "Real locations", "Where the fans are"];

export function Hero() {
  return (
    <div className="flex flex-col gap-7 pt-2">
      <span className="-rotate-3 self-start rounded-xl bg-accent px-3.5 py-2 text-[15px] font-bold text-[#121211]">
        for music-video and short-film directors
      </span>
      <h2 className="type-poster text-[clamp(4.25rem,8.6vw,8rem)]">
        your voice,
        <br />
        their taste.
      </h2>
      <p className="max-w-[34ch] text-[1.3rem] leading-[1.45] text-dim">
        Give it an artist and a city. It reads what the fans actually love on Qloo and writes a treatment you can pitch, with receipts for
        every pick.
      </p>
      <ul aria-label="What a treatment includes" className="flex flex-wrap gap-2">
        {WHAT.map((item) => (
          <li key={item} className="rounded-full border border-line bg-card px-4 py-2 text-[15px]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

const TILT = ["-rotate-3", "rotate-2", "-rotate-2", "rotate-3"];
const posterTitle = "text-[clamp(1.6rem,2.3vw,2.15rem)] leading-[0.92] font-extrabold tracking-[-0.045em] text-balance";

/**
 * The brief as a poster before it is built: the artist (or the films a short is after) and the city, filled in as
 * the director types. It repeats the form, so screen readers skip it.
 */
function YourPoster({ form, running }: { form: FormState; running: boolean }) {
  const { t, unc } = useLingo();
  const isVideo = form.format === "music_video";
  const who = form.artist.trim();
  const after = splitTitles(form.touchstones);
  const where = form.city.trim() || "your city";
  const title = who || (isVideo ? "your artist here" : after.length > 0 ? `after ${after[0]}` : "your short here");
  const line = isVideo
    ? `Music video${who ? ` for ${who}` : ""}, ${where}`
    : `Short film${after.length > 0 ? ` after ${after.join(" and ")}` : ""}, ${where}`;
  return (
    <div
      aria-hidden
      className="surface-dark flex h-full flex-col overflow-hidden rounded-[26px] bg-frame [outline:2px_dashed_var(--accent)] [outline-offset:-10px]"
    >
      <span className="flex aspect-[4/5] w-full flex-col justify-between gap-3.5 p-5">
        <span className="font-mono text-[12px] text-dim">{t.yourPoster}</span>
        <span className="flex flex-col gap-3">
          <span className="flex -rotate-3 items-center gap-2 self-start rounded-xl bg-accent px-3 py-1.5 text-[15px] font-bold text-[#121211]">
            {running && <span className="size-2 rounded-full bg-[#121211] motion-safe:animate-pulse" />}
            {running ? t.cooking : unc ? `${t.giving}: ?` : `${t.giving}… ?`}
          </span>
          <span className={`${posterTitle} ${who || after.length > 0 ? "text-foreground" : "text-faint"}`}>{title}</span>
          <span className="text-[15px] text-dim">{line}</span>
        </span>
      </span>
      <span className="h-3 w-full bg-[#2a2926]" />
    </div>
  );
}

/**
 * "Now showing": the director's own poster first, then the featured treatments as posters (the cover's colour and
 * still, a sticker, the title and the palette). Featured ones open instantly from the pre-built set.
 */
export function NowShowing({
  ref,
  examples,
  covers,
  form,
  running,
  onTry,
}: {
  ref?: Ref<HTMLElement>;
  examples: Example[];
  covers: FeaturedCover[];
  form: FormState;
  running: boolean;
  onTry: (example: Example) => void;
}) {
  const { t, unc } = useLingo();
  const featured = examples.flatMap((example) => {
    const cover = covers.find((c) => c.slug === example.slug);
    return cover ? [{ example, cover }] : [];
  });
  return (
    <section ref={ref} aria-labelledby="featured-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="featured-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
          {featured.length > 0 ? t.nowShowing : t.yourPoster}
        </h2>
        {featured.length > 0 && <p className="text-[16px] text-faint">Built from live Qloo data. They open instantly.</p>}
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-4">
        <li>
          <YourPoster form={form} running={running} />
        </li>
        {featured.map(({ example, cover }, i) => (
          <li key={example.slug}>
            <button
              type="button"
              onClick={() => onTry(example)}
              className="surface-dark flex w-full flex-col overflow-hidden rounded-[26px] text-left"
              style={{ background: darkOf(cover.palette) }}
            >
              <span className="relative isolate flex aspect-[4/5] w-full flex-col justify-end gap-3.5 p-5">
                {cover.still && <Still src={cover.still} alt="" className="absolute inset-0 -z-10 size-full opacity-45" />}
                <span
                  aria-hidden
                  className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgb(10_9_8/0.88)_0%,rgb(10_9_8/0.25)_62%,rgb(10_9_8/0.45)_100%)]"
                />
                {cover.tone && (
                  <span
                    className={`${TILT[i % TILT.length]} self-start rounded-xl bg-accent px-3 py-1.5 text-[15px] font-bold text-[#121211]`}
                  >
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
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const STEPS = [
  ["Read the fans", "Qloo shows what the artist's audience over-indexes on, and where it meets your own taste."],
  ["Find where they are", "A heatmap of the city picks the neighbourhood to base the shoot in."],
  ["Plan and write", "The model turns that evidence into a concept, beats, wardrobe and locations."],
  ["Bring receipts", "Every film, brand and place shows why Qloo picked it, kept apart from the writing."],
] as const;

/** The steps in words, for a server without a featured run to replay (mock mode). */
export function HowItWorks() {
  const { t } = useLingo();
  return (
    <section aria-labelledby="how-heading" className="flex flex-col gap-6">
      <h2 id="how-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
        {t.watchItWork}
      </h2>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="flex flex-col gap-2.5 rounded-[22px] border border-line bg-card p-5">
            <span aria-hidden className="text-[15px] font-bold text-faint">
              0{i + 1}
            </span>
            <span className="type-head text-[1.4rem] leading-tight">{title}</span>
            <span className="text-[16px] leading-6 text-dim">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
