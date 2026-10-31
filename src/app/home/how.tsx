"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import type { FeaturedRun } from "@/lib/agent/featured";
import { STEP_LABELS } from "@/lib/agent/options";
import { useScrollFrame } from "../smooth";
import { ShootBaseBlock } from "../studio/base-map";
import { useLingo } from "../studio/lingo";
import { titleFont, titleStyle, suggestTitleFontFrom } from "../studio/title-fonts";
import { evidenceTone, rankMark, slip } from "../studio/ui";
import { CutLink } from "./cut-link";
import { useArrivals } from "./ending";
import { headHeight, reducedMotion } from "./motion";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const percent = (share: number) => `${Math.round(share * 100)}%`;

interface Step {
  title: string;
  text: string;
  show: ReactNode;
  /** Step 2: its words and the shoot base on the left, the map down the right. */
  split?: { base: ReactNode; map: ReactNode };
}

/**
 * Lays the steps out for the screen: each one holds the screen for a while when it fits on one (on a short screen it
 * just scrolls), its words rising in first, then what it made. Step 2's map is as tall as its words and card together.
 */
function useSteps() {
  const list = useRef<HTMLOListElement>(null);
  const s = useRef({ vw: 0, vh: 0 }).current;
  const measure = () => {
    const ol = list.current;
    if (!ol) return;
    s.vw = innerWidth;
    s.vh = innerHeight;
    const reduce = reducedMotion();
    const avail = innerHeight - headHeight();
    ol.querySelectorAll<HTMLElement>(".how-map").forEach((map) => {
      const words = map.parentElement?.querySelector<HTMLElement>(".how-words");
      const base = map.parentElement?.querySelector<HTMLElement>(".how-base");
      if (!words || !base || innerWidth < 900) return map.style.removeProperty("--map-height");
      const left = base.getBoundingClientRect().bottom - words.getBoundingClientRect().top;
      // The block's own padding and the legend under the map take about 76px of that.
      map.style.setProperty("--map-height", `${Math.max(256, Math.round(left - 76))}px`);
    });
    ol.querySelectorAll<HTMLElement>(".how-step").forEach((step) => {
      delete step.dataset.pinned;
      step.style.height = "";
      const pin = step.querySelector<HTMLElement>(".how-pin");
      if (!pin) return;
      const cs = getComputedStyle(pin);
      const need = pin.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) + 48;
      if (!reduce && need <= avail) {
        step.dataset.pinned = "";
        step.style.height = `${Math.round(avail + innerHeight * 0.7)}px`;
      }
    });
  };
  useScrollFrame(() => {
    if (innerWidth !== s.vw || Math.abs(innerHeight - s.vh) > 150) measure();
    list.current?.querySelectorAll<HTMLElement>(".how-step").forEach((step) => {
      const top = step.getBoundingClientRect().top;
      if (top < innerHeight * 0.74) step.querySelectorAll<HTMLElement>(".sa").forEach((x) => (x.dataset.on = ""));
      if (top < innerHeight * 0.38) step.querySelectorAll<HTMLElement>(".sb").forEach((x) => (x.dataset.on = ""));
    });
  });
  return list;
}

function StepWords({ i, of, title, text }: { i: number; of: number; title: string; text: string }) {
  return (
    <div className="how-words sa flex max-w-[44rem] flex-col gap-2.5">
      <span className="text-ui font-semibold text-faint tabular-nums">
        Step {i + 1} of {of}
      </span>
      <h3 className="type-head text-section leading-[0.95] lg:text-display-sm">{title}</h3>
      <p className="max-w-[46ch] text-lead leading-normal text-dim lg:text-prose">{text}</p>
    </div>
  );
}

/** "Watch it work": one real featured run, a step to a screen, each step and then what it made. */
export function HowItWorks({ run }: { run: FeaturedRun }) {
  const { t } = useLingo();
  const list = useSteps();
  const head = useArrivals<HTMLDivElement>();
  const chosen = run.base.areas.find((a) => a.ref === run.base.chosen) ?? run.base.areas[0];
  const font = titleFont(suggestTitleFontFrom({ mock: run.mock, city: run.city, base: chosen?.name, tags: run.tags }).id);
  const heatmap = run.mock ? "A synthetic heatmap" : "Qloo's heatmap";
  const steps: Step[] = [
    {
      title: STEP_LABELS.audience,
      text: `Qloo reads what ${run.subject}'s audience over-indexes on: moods, genres, and the age and gender it leans to. It describes a group, never one person.`,
      show: (
        <div className="flex flex-col gap-4 rounded-[28px] border border-line bg-card p-5 sm:p-8">
          <p className="text-small font-bold text-dim">{capitalize(run.audience)}</p>
          <ul className="flex flex-wrap gap-2.5">
            {run.tones.map((tone) => (
              <li
                key={tone.name}
                className={`inline-flex min-h-13 items-center rounded-full px-5 text-lead lg:text-prose ${
                  tone.shared ? "bg-accent font-bold text-ink" : "border border-line bg-field"
                }`}
              >
                {tone.name}
              </li>
            ))}
          </ul>
          {run.leans && <p className={`type-evidence text-caption ${evidenceTone(run.mock)}`}>{run.leans}</p>}
        </div>
      ),
    },
    {
      title: STEP_LABELS.heatmap,
      text: `A heatmap of ${run.city} shows where those fans cluster. The strongest area becomes the shoot base, so the locations stay close together and the crew moves less.`,
      show: null,
      split: chosen && {
        base: (
          <div className="surface-dark flex flex-col gap-2.5 rounded-[28px] bg-frame p-5 text-foreground sm:p-8">
            <p className="text-ui font-bold text-dim">Shoot base</p>
            <p className="type-poster text-display-sm">{chosen.name}</p>
            <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-lead leading-normal text-dim">
              <b className={`rounded-md px-2 py-0.5 text-subhead font-extrabold ${rankMark(run.mock)}`}>{percent(chosen.share)}</b>
              of this audience&apos;s strongest spots in {run.city}
            </p>
            <p className="max-w-[42ch] text-lead leading-normal text-dim">
              <strong className="text-foreground">Where the fans are.</strong> {heatmap} of {run.audience} across {run.city}, drawn as
              contour lines: the bolder the line, the stronger this audience is inside it.
            </p>
          </div>
        ),
        map: (
          <div
            className="how-map sb"
            style={{ "--d": "160ms" } as CSSProperties}
            role="img"
            aria-label={`Map of ${run.city}: where ${run.audience} is strongest, as contour lines, with ${chosen.name} ringed as the shoot base`}
          >
            <ShootBaseBlock base={run.base} city={run.city} audience={run.audience} mock={run.mock} compact mapOnly />
          </div>
        ),
      },
    },
    {
      title: "Bring receipts",
      text: "Films, wardrobe brands and places, each ranked for this audience. The rank and the affinity are Qloo's, not the model's.",
      show: (
        <ul className="slips">
          {run.receipts.map((r) => (
            <li
              key={r.kind}
              data-receipt={run.mock ? "mock" : "qloo"}
              className={`flex flex-col gap-1 rounded-t-[4px] rounded-b-2xl border-t-[3px] border-dashed px-4.5 pt-4 pb-4.5 font-mono text-caption leading-[1.6] tabular-nums ${slip(run.mock)}`}
            >
              <span className="text-label font-medium tracking-[0.06em] uppercase">{run.mock ? `mock ${r.kind}` : r.kind}</span>
              <b className="mb-1 font-sans text-lead leading-tight font-extrabold tracking-[-0.02em]">{r.name}</b>
              <span>
                <mark className={`px-1.5 ${rankMark(run.mock)}`}>
                  rank {r.rank} of {r.of}
                </mark>{" "}
                for this audience
              </span>
              {r.affinity !== undefined && <span>affinity {r.affinity.toFixed(3)}</span>}
              {r.km !== undefined && <span>{r.km} km from the base</span>}
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: STEP_LABELS.write,
      text: `${run.writtenBy} writes the treatment around that evidence, and every film, brand and place it names is one Qloo returned.`,
      show: (
        <CutLink
          href={`/t/${run.slug}`}
          className="surface-dark flex w-full flex-col gap-4 rounded-[28px] bg-frame p-6 text-foreground sm:p-12"
        >
          <span className="text-balance" style={titleStyle(font, "var(--text-display)")}>
            {run.title}
          </span>
          <span className="max-w-[44ch] font-serif text-prose leading-[1.32] text-pretty text-dim italic">{run.logline}</span>
          <span className="text-ui font-bold underline decoration-edge underline-offset-4">Read the whole treatment</span>
        </CutLink>
      ),
    },
  ];
  return (
    <section aria-labelledby="how" className="pb-6 sm:pb-18">
      <div ref={head} className="how-head mx-auto w-full max-w-[80rem] px-4 sm:px-8">
        <div className="rv flex flex-col gap-4">
          <h2 id="how" className="type-head text-display leading-[0.95] tracking-[-0.045em]">
            {t.watchItWork}
          </h2>
          <p className="max-w-[40ch] text-lead leading-normal text-dim lg:text-prose">
            One real run, step by step: {run.subject} in {run.city}.
          </p>
        </div>
      </div>
      <ol ref={list}>
        {steps.map((step, i) => (
          <li key={step.title} className="how-step">
            {step.split ? (
              <div className="how-pin how-pin--split mx-auto w-full max-w-[80rem] px-4 sm:px-8">
                <StepWords i={i} of={steps.length} title={step.title} text={step.text} />
                <div className="how-base sb">{step.split.base}</div>
                {step.split.map}
              </div>
            ) : (
              <div className="how-pin mx-auto w-full max-w-[80rem] px-4 sm:px-8">
                <StepWords i={i} of={steps.length} title={step.title} text={step.text} />
                <div className="sb w-full">{step.show}</div>
              </div>
            )}
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
  ["Bring receipts", "Every film, face, brand and place shows why Qloo picked it, kept apart from the writing."],
] as const;

/** The steps in words, for a server without a featured run to show (mock mode, or no keys). */
export function HowItWorksSteps() {
  const { t } = useLingo();
  return (
    <section aria-labelledby="how" className="mx-auto flex w-full max-w-[80rem] flex-col gap-8 px-4 py-24 sm:px-8 sm:py-32">
      <h2 id="how" className="type-head text-display leading-[0.95] tracking-[-0.045em]">
        {t.watchItWork}
      </h2>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="flex flex-col gap-2.5 rounded-[22px] border border-line bg-card p-5">
            <span className="text-ui font-semibold text-faint">Step {i + 1}</span>
            <span className="type-head text-subhead leading-tight">{title}</span>
            <span className="text-body leading-6 text-dim">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
