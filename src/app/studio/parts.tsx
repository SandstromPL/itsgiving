"use client";

import { Fragment, useId, useState, type ReactNode } from "react";
import { excerpt, tagLabel } from "@/lib/agent/options";
import type { QlooEvidence, Treatment } from "@/lib/agent/types";
import type { LlmMode } from "@/lib/llm/config";
import type { ProducedBy } from "@/lib/llm/generate";
import type { Reasoning } from "@/lib/llm/types";
import type { QlooMode } from "@/lib/qloo/client";
import { evidenceTone, paperEvidence, rankMark, slip } from "./ui";

/** Pink "camera tape" label for anything mocked. */
export function Tape({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full bg-tape-wash px-2.5 py-1 text-label leading-4 font-semibold text-tape ring-1 ring-tape/40"
    >
      {children}
    </span>
  );
}

/** The pipeline asks DeepSeek for high reasoning on deep treatments and low on quick ones. */
export function thinkingName(reasoning: Reasoning): string {
  return reasoning === "high" ? "deep thinking" : "quick thinking";
}

export function modelName(by: ProducedBy): string {
  if (by.mock) return "Mock LLM";
  return by.reasoning ? `${by.model} with ${thinkingName(by.reasoning)}` : by.model;
}

/**
 * Data-source badges. Before any run they come from the server at request
 * time (see live-modes.tsx); after a run, from the run itself.
 */
export function ModeBadges({ qloo, llm, treatment }: { qloo: QlooMode; llm: LlmMode; treatment?: Treatment }) {
  const writer = treatment?.writtenBy;
  const mockedSteps = treatment?.llm.filter((t) => t.producedBy.mock && t.step !== "write").map((t) => t.step) ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-caption">
      {qloo === "mock" ? (
        <Tape title="Synthetic fixtures with real names; every score is invented. Not Qloo data.">Mock data</Tape>
      ) : (
        // Below laptop width the header keeps to its rows (the switches would drop under the logo at a tablet's 768 px);
        // only the mock warnings must show there.
        <span className="hidden items-center gap-2 whitespace-nowrap lg:inline-flex">
          <span aria-hidden className="size-2 rounded-full bg-[#1f8a4c]" />
          Live Qloo data
        </span>
      )}
      {writer ? (
        writer.mock ? (
          <Tape title="A deterministic template wrote this treatment, not a language model.">Mock LLM</Tape>
        ) : (
          // Phones keep the header short; the run log and the credits name the model too.
          <span className="hidden text-dim lg:inline">
            Written by <span className="font-semibold text-foreground">{writer.model}</span>
            {writer.reasoning && `, ${thinkingName(writer.reasoning)}`}
          </span>
        )
      ) : llm === "mock" ? (
        <Tape title="No LLM key is set, so a deterministic template plans and writes.">Mock LLM</Tape>
      ) : null}
      {writer && !writer.mock && mockedSteps.length > 0 && (
        <Tape title="Live models were unavailable for this step, so a deterministic template did it.">
          Mock LLM {mockedSteps.join(" and ")}
        </Tape>
      )}
    </div>
  );
}

/** Shown in place of the badges until the server has said which data sources are live. */
export function ModesPending() {
  return <span className="hidden text-caption text-faint lg:inline">Checking data sources…</span>;
}

/** Qloo's image server answers a picture it no longer has with a blank square, 30 px wide. */
const qlooPlaceholder = (img: HTMLImageElement) => img.naturalWidth > 0 && img.naturalWidth <= 30 && img.naturalHeight <= 30;

/** An image from Qloo (or a mock placeholder); plain <img> because hosts vary per entity. */
export function Still({
  src,
  alt,
  className = "",
  loading = "lazy",
}: {
  src?: string;
  alt: string;
  className?: string;
  /** Eager for a page's first picture (a board's cover), lazy for the rest. */
  loading?: "lazy" | "eager";
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div aria-hidden className={`flex items-end bg-field p-4 ${className}`}>
        <span className="type-head line-clamp-2 text-subhead leading-tight text-foreground/20">{alt}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote Qloo images from many hosts; no optimizer config needed
    <img
      src={src}
      alt={alt}
      loading={loading}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      // Qloo's blank stands for a missing picture too, so the name shows instead; the ref catches one that loaded before
      // the page came to life, when no handler was listening yet.
      onLoad={(event) => qlooPlaceholder(event.currentTarget) && setBroken(true)}
      ref={(img) => {
        if (img && qlooPlaceholder(img)) setBroken(true);
      }}
      className={`bg-field object-cover ${className}`}
    />
  );
}

function pct(value: number | undefined | null): string | undefined {
  return typeof value === "number" ? value.toFixed(3) : undefined;
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
}

/**
 * Qloo's evidence for one pick, printed like a receipt: where it ranked in its call, its affinity and which input
 * drove it. Pink when the mock stands in for Qloo, so mock numbers never pass as Qloo's. Always on paper, even on a
 * dark frame.
 */
export function Receipt({
  qloo,
  mock,
  label,
  className = "",
  children,
}: {
  qloo: QlooEvidence;
  mock: boolean;
  /** What the receipt is for, when the slip stands apart from its item ("the still: Sita Ramam"). */
  label?: string;
  className?: string;
  /** A last line under the evidence: the board's "why this film", which opens the whole read. */
  children?: ReactNode;
}) {
  const affinity = pct(qloo.affinity);
  return (
    <div
      data-receipt={mock ? "mock" : "qloo"}
      className={`rounded-xl border border-dashed px-3.5 py-3 font-mono text-label leading-[1.65] tabular-nums ${slip(mock)} ${className}`}
    >
      <p className="font-semibold">{mock ? "Mock receipt, not Qloo" : "Qloo receipt"}</p>
      {label && <p>{label}</p>}
      <p>
        <span className={`px-1 ${rankMark(mock)}`}>
          rank {qloo.rank} of {qloo.of}
        </span>{" "}
        for this audience
      </p>
      {affinity && <p>affinity {affinity}</p>}
      {qloo.because[0] && <p>picked because of {qloo.because[0].name}</p>}
      {children}
    </div>
  );
}

/** Qloo's own words about an item on its card (a place's atmosphere, a brand's style), marked as Qloo's, shortened. */
export function QlooNote({ text, mock, max = 180 }: { text?: string; mock: boolean; max?: number }) {
  if (!text) return null;
  return (
    <p className="text-small leading-5 text-dim">
      <span className={`font-mono text-label font-semibold ${evidenceTone(mock)}`}>{mock ? "Mock note" : "Qloo"} </span>
      {/* The whole note is in the item's Why window. */}
      {excerpt(text, max)}
    </p>
  );
}

/** A few of the item's Qloo tags (style notes for films, aesthetics for brands, kind and mood for places). */
export function QlooTags({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return null;
  return <p className="font-mono text-label leading-5 text-faint">{tags.slice(0, max).map(tagLabel).join(" / ")}</p>;
}

/** What each tool's list holds, in words: the tool names themselves are code. */
const LIST_OF: Record<string, string> = { reference_films: "films", styling_brands: "brands", scout_locations: "places" };

/** "Why" popover: Qloo's evidence on top, itsgiving's interpretation below, never mixed. */
/**
 * A pick's receipt, which opens the whole read: its last line ("why this film") is the button, and its press area
 * spans the slip, so the slip itself is what you tap. The slip shows the focus ring. On paper the line is left out.
 */
export function Why({
  label,
  name,
  qloo,
  read,
  writtenBy,
  mock,
  facts = [],
  of,
  className = "",
}: {
  label: string;
  name: string;
  qloo: QlooEvidence;
  /** What the ranked list holds, in words ("series"), where the tool's own list says otherwise. */
  of?: string;
  read: { term: string; text: string }[];
  writtenBy: ProducedBy;
  /** True when the evidence came from the synthetic mock, not Qloo. */
  mock: boolean;
  /** What Qloo itself says about the item (a place's atmosphere, a brand's style), listed with its evidence. */
  facts?: { term: string; text?: string }[];
  /** Placement of the receipt in its card. */
  className?: string;
}) {
  const id = useId();
  const evidence = paperEvidence(mock);
  return (
    <>
      {/* The slip is the target: the button's hit area is stretched over it, so the press shows on the slip. The button
          itself mustn't scale (--press: none): a scaled button would hold that hit area inside its own small box, and a
          press begun on the slip would end outside the button and never open the window. */}
      <Receipt
        qloo={qloo}
        mock={mock}
        className={`group relative transition-[scale] duration-150 hover:border-solid has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-foreground motion-safe:has-[button:active]:scale-[0.98] ${className}`}
      >
        <button
          type="button"
          popoverTarget={id}
          className="mt-1 cursor-pointer font-semibold underline decoration-1 underline-offset-[3px] [--press:none] group-hover:decoration-2 after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none print:hidden"
        >
          {label}
          <span className="sr-only">: {name}</span>
        </button>
      </Receipt>
      <div id={id} popover="auto" className="why" role="dialog" aria-label={`Why ${name}`}>
        <div className="p-6">
          <p className="type-head text-title leading-tight">{name}</p>
          <section className="mt-4">
            <h3 className={`font-mono text-label leading-4 font-semibold ${evidence}`}>
              {mock ? "Mock data (synthetic, not Qloo)" : "From Qloo"}
            </h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-label leading-5 tabular-nums text-slip-ink">
              <dt className="text-faint">Rank</dt>
              <dd>
                {qloo.rank} of {qloo.of} {of ?? LIST_OF[qloo.tool] ?? "picks"} for this audience
              </dd>
              {pct(qloo.affinity) && (
                <>
                  <dt className="text-faint">Affinity</dt>
                  <dd>{pct(qloo.affinity)} (only comparable within this list)</dd>
                </>
              )}
              {typeof qloo.popularity === "number" && (
                <>
                  <dt className="text-faint">Popularity</dt>
                  <dd>{ordinal(Math.round(qloo.popularity * 100))} percentile</dd>
                </>
              )}
              {qloo.because.length > 0 && (
                <>
                  <dt className="text-faint">Driven by</dt>
                  <dd>{qloo.because.map((b) => `${b.name} (${b.score.toFixed(2)})`).join(", ")}</dd>
                </>
              )}
              {qloo.tags.length > 0 && (
                <>
                  <dt className="text-faint">Tags</dt>
                  <dd>{qloo.tags.slice(0, 6).map(tagLabel).join(", ")}</dd>
                </>
              )}
              {facts.map(
                ({ term, text }) =>
                  text && (
                    <Fragment key={term}>
                      <dt className="text-faint">{term}</dt>
                      <dd>{text}</dd>
                    </Fragment>
                  ),
              )}
            </dl>
            <p className="mt-2 text-label leading-5 text-faint">
              Aggregate audience affinity: what fans of the input over-index on, not a fact about any one person.
            </p>
          </section>
          <section className="mt-5 border-t border-line pt-4">
            <h3 className="text-label leading-4 font-semibold">itsgiving&apos;s read</h3>
            <dl className="mt-2 flex flex-col gap-2">
              {read.map((r) => (
                <div key={r.term}>
                  <dt className="text-label leading-4 text-faint">{r.term}</dt>
                  <dd className="font-serif text-lead leading-snug">{r.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-label leading-4 text-faint">Interpretation by {modelName(writtenBy)}.</p>
          </section>
          {/* autoFocus moves focus into the popover when it opens; closing returns it to the invoker. */}
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            autoFocus
            className="mt-5 rounded-full bg-ink px-5 py-2.5 text-small leading-5 font-bold text-white"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
