"use client";

import type { Example } from "@/lib/agent/examples";
import type { FeaturedCover } from "@/lib/agent/featured";
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
      <h2 className="type-poster text-[clamp(4.25rem,9.2vw,8.5rem)]">
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

/** The featured treatments as posters: the cover's colour and still, a sticker, the title and the palette. */
export function FeaturedPosters({
  examples,
  covers,
  onTry,
}: {
  examples: Example[];
  covers: FeaturedCover[];
  onTry: (example: Example) => void;
}) {
  const { t, unc } = useLingo();
  const featured = examples.flatMap((example) => {
    const cover = covers.find((c) => c.slug === example.slug);
    return cover ? [{ example, cover }] : [];
  });
  if (featured.length === 0) return null;
  return (
    <section aria-labelledby="featured-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 id="featured-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
          Featured treatments
        </h2>
        <p className="text-[16px] text-faint">Built from live Qloo data. They open instantly.</p>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-5">
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
                <span className="text-[2.6rem] leading-[0.92] font-extrabold tracking-[-0.045em] text-balance">{cover.title}</span>
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

export function HowItWorks() {
  return (
    <section aria-labelledby="how-heading" className="flex flex-col gap-6">
      <h2 id="how-heading" className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-none">
        How it works
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

/** Examples without a pre-built treatment: they run live. */
export function TryExamples({
  examples,
  covers,
  onTry,
}: {
  examples: Example[];
  covers: FeaturedCover[];
  onTry: (example: Example) => void;
}) {
  const plain = examples.filter((example) => !covers.some((c) => c.slug === example.slug));
  if (plain.length === 0) return null;
  return (
    <section aria-labelledby="examples-heading" className="flex flex-col gap-5">
      <h2 id="examples-heading" className="type-head text-[1.6rem] leading-none">
        {covers.length > 0 ? "Or try a live run" : "Start from an example"}
      </h2>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3">
        {plain.map((example) => (
          <li key={example.slug}>
            <button
              type="button"
              onClick={() => onTry(example)}
              className="flex h-full w-full flex-col items-start gap-1 rounded-[22px] border border-line bg-card p-4 text-left hover:border-foreground"
            >
              <span className="type-head text-[1.25rem] leading-tight">{example.title}</span>
              <span className="text-[15px] leading-6 text-dim">{example.detail}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
