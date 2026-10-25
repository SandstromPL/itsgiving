"use client";

import { useId, useState, type ReactNode } from "react";
import type { QlooEvidence, Treatment } from "@/lib/agent/types";
import type { LlmMode } from "@/lib/llm/config";
import type { ProducedBy } from "@/lib/llm/generate";
import type { Reasoning } from "@/lib/llm/types";
import type { QlooMode } from "@/lib/qloo/client";

/** Pink "camera tape" label for anything mocked. */
export function Tape({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center rounded-sm bg-tape/15 px-2 py-0.5 text-xs font-medium text-tape ring-1 ring-tape/30">
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
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {qloo === "mock" ? (
        <Tape title="Synthetic fixtures with real names; every score is invented. Not Qloo data.">Mock data</Tape>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-graphite px-2.5 py-1 text-paper ring-1 ring-line">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
          Live Qloo data
        </span>
      )}
      {writer ? (
        writer.mock ? (
          <Tape title="A deterministic template wrote this treatment, not a language model.">Mock LLM</Tape>
        ) : (
          // Phones keep the header to one line; the run log and the credits name the model too.
          <span className="hidden rounded-full bg-graphite px-2.5 py-1 text-dim ring-1 ring-line sm:inline">
            Written by <span className="text-paper">{writer.model}</span>
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
  return <span className="text-xs text-faint">Checking data sources…</span>;
}

/** An image from Qloo (or a mock placeholder); plain <img> because hosts vary per entity. */
export function Still({ src, alt, className = "" }: { src?: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div aria-hidden className={`flex items-end bg-graphite p-3 ${className}`}>
        <span className="type-head line-clamp-2 text-2xl leading-tight text-paper/15">{alt}</span>
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
      className={`bg-graphite object-cover ${className}`}
    />
  );
}

function pct(value: number | undefined | null): string | undefined {
  return typeof value === "number" ? value.toFixed(2) : undefined;
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
}

/** Evidence colour: tungsten for Qloo, tape pink for the synthetic mock, so mock numbers never pass as Qloo's. */
const evidenceTone = (mock: boolean) => (mock ? "text-tape" : "text-tungsten");

/** One line of Qloo evidence, set like a camera report: where the item ranked in its call, and why. */
export function EdgeCode({ qloo, mock }: { qloo: QlooEvidence; mock: boolean }) {
  const affinity = pct(qloo.affinity);
  return (
    <p className={`type-evidence flex flex-wrap gap-x-3 text-[11.5px] leading-5 ${evidenceTone(mock)}`}>
      <span>
        {mock ? "Mock" : "Qloo"} #{qloo.rank} of {qloo.of}
      </span>
      {affinity && <span>affinity {affinity}</span>}
      {qloo.because[0] && <span>via {qloo.because[0].name}</span>}
    </p>
  );
}

/** A few of the item's Qloo tags (style notes for films, aesthetics for brands, kind and mood for places). */
export function QlooTags({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return null;
  return <p className="type-evidence text-[11.5px] leading-5 text-dim">{tags.slice(0, max).join(" / ")}</p>;
}

/** "Why" popover: Qloo's evidence on top, Mise's interpretation below, never mixed. */
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
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className="self-start rounded-sm text-xs text-dim underline decoration-edge underline-offset-4 hover:text-paper hover:decoration-dim"
      >
        {label}
        <span className="sr-only">: {name}</span>
      </button>
      <div id={id} popover="auto" className="why" role="dialog" aria-label={`Why ${name}`}>
        <p className="type-head text-2xl leading-tight">{name}</p>
        <section className="mt-4">
          <h3 className={`text-xs font-medium ${evidenceTone(mock)}`}>{mock ? "Mock data (synthetic, not Qloo)" : "From Qloo"}</h3>
          <dl className="type-evidence mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs leading-5 text-paper/90">
            <dt className="text-dim">Rank</dt>
            <dd>
              {qloo.rank} of {qloo.of} from {qloo.tool}
            </dd>
            {pct(qloo.affinity) && (
              <>
                <dt className="text-dim">Affinity</dt>
                <dd>{pct(qloo.affinity)} (only comparable within this list)</dd>
              </>
            )}
            {typeof qloo.popularity === "number" && (
              <>
                <dt className="text-dim">Popularity</dt>
                <dd>{ordinal(Math.round(qloo.popularity * 100))} percentile</dd>
              </>
            )}
            {qloo.because.length > 0 && (
              <>
                <dt className="text-dim">Driven by</dt>
                <dd>{qloo.because.map((b) => `${b.name} (${b.score.toFixed(2)})`).join(", ")}</dd>
              </>
            )}
            {qloo.tags.length > 0 && (
              <>
                <dt className="text-dim">Tags</dt>
                <dd>{qloo.tags.slice(0, 6).join(", ")}</dd>
              </>
            )}
            {note && (
              <>
                <dt className="text-dim">Atmosphere</dt>
                <dd>{note}</dd>
              </>
            )}
          </dl>
          <p className="mt-2 text-xs leading-5 text-dim">
            Aggregate audience affinity: what fans of the input over-index on, not a fact about any one person.
          </p>
        </section>
        <section className="mt-5 border-t border-line pt-4">
          <h3 className="text-xs font-medium text-paper">Mise&apos;s read</h3>
          <dl className="mt-2 flex flex-col gap-2 text-sm leading-6">
            {read.map((r) => (
              <div key={r.term}>
                <dt className="text-dim">{r.term}</dt>
                <dd>{r.text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-dim">Interpretation by {modelName(writtenBy)}.</p>
        </section>
        {/* autoFocus moves focus into the popover when it opens; closing returns it to the invoker. */}
        <button
          type="button"
          popoverTarget={id}
          popoverTargetAction="hide"
          autoFocus
          className="mt-5 rounded-sm px-3 py-1.5 text-sm ring-1 ring-line hover:ring-dim"
        >
          Close
        </button>
      </div>
    </>
  );
}
