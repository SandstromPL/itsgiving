"use client";

import { useId, useState, type ReactNode } from "react";
import type { QlooEvidence, Treatment } from "@/lib/agent/types";
import type { LlmMode } from "@/lib/llm/config";
import type { ProducedBy } from "@/lib/llm/generate";
import type { Reasoning } from "@/lib/llm/types";
import type { QlooMode } from "@/lib/qloo/client";

/** A left arrow, for the ways back from a treatment to the studio. */
export function BackArrow() {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

/** Pink "camera tape" label for anything mocked. */
export function Tape({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full bg-tape-wash px-2.5 py-1 text-xs font-semibold text-tape ring-1 ring-tape/40"
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
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      {qloo === "mock" ? (
        <Tape title="Synthetic fixtures with real names; every score is invented. Not Qloo data.">Mock data</Tape>
      ) : (
        <span className="inline-flex items-center gap-2 rounded-full border border-foreground px-3 py-1.5 whitespace-nowrap">
          <span aria-hidden className="size-2 rounded-full bg-[#1f8a4c]" />
          Live Qloo data
        </span>
      )}
      {writer ? (
        writer.mock ? (
          <Tape title="A deterministic template wrote this treatment, not a language model.">Mock LLM</Tape>
        ) : (
          // Phones keep the header short; the run log and the credits name the model too.
          <span className="hidden rounded-full border border-line bg-card px-3 py-1.5 text-dim lg:inline">
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
  return <span className="text-[13px] text-faint">Checking data sources…</span>;
}

/** An image from Qloo (or a mock placeholder); plain <img> because hosts vary per entity. */
export function Still({ src, alt, className = "" }: { src?: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div aria-hidden className={`flex items-end bg-field p-4 ${className}`}>
        <span className="type-head line-clamp-2 text-2xl leading-tight text-foreground/20">{alt}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote Qloo images from many hosts; no optimizer config needed
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
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
export function Receipt({ qloo, mock, className = "" }: { qloo: QlooEvidence; mock: boolean; className?: string }) {
  const affinity = pct(qloo.affinity);
  return (
    <div
      className={`rounded-xl border border-dashed px-3.5 py-3 font-mono text-[12.5px] leading-[1.65] tabular-nums ${
        mock ? "border-[#e79ac0] bg-[#fff5fa] text-[#a3195b]" : "border-[#c9c1af] bg-[#fffdf6] text-[#2b2925]"
      } ${className}`}
    >
      <p className="font-semibold">{mock ? "Mock receipt, not Qloo" : "Qloo receipt"}</p>
      <p>
        <span className={`px-1 ${mock ? "bg-[#ffd6ea]" : "bg-accent"} text-[#121211]`}>
          rank {qloo.rank} of {qloo.of}
        </span>{" "}
        for this audience
      </p>
      {affinity && <p>affinity {affinity}</p>}
      {qloo.because[0] && <p>picked because of {qloo.because[0].name}</p>}
    </div>
  );
}

/** A few of the item's Qloo tags (style notes for films, aesthetics for brands, kind and mood for places). */
export function QlooTags({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return null;
  return <p className="font-mono text-[12px] leading-5 text-faint">{tags.slice(0, max).join(" / ")}</p>;
}

/** "Why" popover: Qloo's evidence on top, itsgiving's interpretation below, never mixed. */
export function Why({
  label,
  name,
  qloo,
  read,
  writtenBy,
  mock,
  note,
}: {
  label: string;
  name: string;
  qloo: QlooEvidence;
  read: { term: string; text: string }[];
  writtenBy: ProducedBy;
  /** True when the evidence came from the synthetic mock, not Qloo. */
  mock: boolean;
  /** Qloo's own description of the item, e.g. a place's atmosphere. */
  note?: string;
}) {
  const id = useId();
  const evidence = mock ? "text-[#a3195b]" : "text-[#855000]";
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className="self-start rounded-full border border-foreground px-3.5 py-2 text-sm font-semibold hover:bg-foreground hover:text-background print:hidden"
      >
        {label}
        <span className="sr-only">: {name}</span>
      </button>
      <div id={id} popover="auto" className="why" role="dialog" aria-label={`Why ${name}`}>
        <div className="p-6">
          <p className="type-head text-[1.75rem] leading-tight">{name}</p>
          <section className="mt-4">
            <h3 className={`font-mono text-xs font-semibold ${evidence}`}>{mock ? "Mock data (synthetic, not Qloo)" : "From Qloo"}</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs leading-5 tabular-nums text-[#2b2925]">
              <dt className="text-[#5e5a52]">Rank</dt>
              <dd>
                {qloo.rank} of {qloo.of} from {qloo.tool}
              </dd>
              {pct(qloo.affinity) && (
                <>
                  <dt className="text-[#5e5a52]">Affinity</dt>
                  <dd>{pct(qloo.affinity)} (only comparable within this list)</dd>
                </>
              )}
              {typeof qloo.popularity === "number" && (
                <>
                  <dt className="text-[#5e5a52]">Popularity</dt>
                  <dd>{ordinal(Math.round(qloo.popularity * 100))} percentile</dd>
                </>
              )}
              {qloo.because.length > 0 && (
                <>
                  <dt className="text-[#5e5a52]">Driven by</dt>
                  <dd>{qloo.because.map((b) => `${b.name} (${b.score.toFixed(2)})`).join(", ")}</dd>
                </>
              )}
              {qloo.tags.length > 0 && (
                <>
                  <dt className="text-[#5e5a52]">Tags</dt>
                  <dd>{qloo.tags.slice(0, 6).join(", ")}</dd>
                </>
              )}
              {note && (
                <>
                  <dt className="text-[#5e5a52]">Atmosphere</dt>
                  <dd>{note}</dd>
                </>
              )}
            </dl>
            <p className="mt-2 text-xs leading-5 text-[#5e5a52]">
              Aggregate audience affinity: what fans of the input over-index on, not a fact about any one person.
            </p>
          </section>
          <section className="mt-5 border-t border-[#dad5ca] pt-4">
            <h3 className="text-xs font-semibold">itsgiving&apos;s read</h3>
            <dl className="mt-2 flex flex-col gap-2">
              {read.map((r) => (
                <div key={r.term}>
                  <dt className="text-xs text-[#5e5a52]">{r.term}</dt>
                  <dd className="font-serif text-lg leading-snug">{r.text}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-[#5e5a52]">Interpretation by {modelName(writtenBy)}.</p>
          </section>
          {/* autoFocus moves focus into the popover when it opens; closing returns it to the invoker. */}
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            autoFocus
            className="mt-5 rounded-full bg-[#121211] px-5 py-2.5 text-sm font-bold text-white"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
