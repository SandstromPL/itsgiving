"use client";

import { useId, type ReactNode } from "react";
import type { QlooEvidence } from "@/lib/agent/types";
import type { ProducedBy } from "@/lib/llm/generate";
import type { LlmMode } from "@/lib/llm/config";
import type { QlooMode } from "@/lib/qloo/client";

/** Pink "camera tape" label for anything mocked. */
export function Tape({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center rounded-sm bg-tape/15 px-2 py-0.5 text-xs font-medium text-tape ring-1 ring-tape/30">
      {children}
    </span>
  );
}

export function modelName(by: ProducedBy): string {
  return by.mock ? "Mock LLM" : by.model;
}

export function ModeBadges({ qloo, llm, writtenBy }: { qloo: QlooMode; llm: LlmMode; writtenBy?: ProducedBy }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {qloo === "mock" ? (
        <Tape title="Synthetic fixtures with real names; every score is invented. Not Qloo data.">Mock data</Tape>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-medium text-emerald-300 ring-1 ring-emerald-400/30">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
          Live Qloo data
        </span>
      )}
      {writtenBy ? (
        writtenBy.mock ? (
          <Tape title="A deterministic template wrote this treatment, not a language model.">Mock LLM</Tape>
        ) : (
          <span className="rounded-sm px-2 py-0.5 text-dim ring-1 ring-line">
            Written by <span className="text-paper">{writtenBy.model}</span>
          </span>
        )
      ) : llm === "mock" ? (
        <Tape title="No LLM key is set, so a deterministic template plans and writes.">Mock LLM</Tape>
      ) : null}
    </div>
  );
}

/** An image from Qloo (or a mock placeholder); plain <img> because hosts vary per entity. */
export function Still({ src, alt, className = "" }: { src?: string; alt: string; className?: string }) {
  if (!src) {
    return (
      <div aria-hidden className={`flex items-end bg-graphite p-3 ${className}`}>
        <span className="line-clamp-2 text-2xl font-semibold leading-tight text-paper/15">{alt}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote Qloo images from many hosts; no optimizer config needed
    <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={`bg-graphite object-cover ${className}`} />
  );
}

function pct(value: number | undefined | null): string | undefined {
  return typeof value === "number" ? value.toFixed(2) : undefined;
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${tail}`;
}

/** One line of Qloo evidence, set like the edge print on film stock. */
export function EdgeCode({ qloo }: { qloo: QlooEvidence }) {
  const affinity = pct(qloo.affinity);
  return (
    <p className="flex flex-wrap gap-x-3 font-mono text-[11px] leading-5 text-tungsten">
      <span>
        Qloo rank {qloo.rank}/{qloo.of}
      </span>
      {affinity && <span>affinity {affinity}</span>}
      {qloo.because[0] && <span>via {qloo.because[0].name}</span>}
    </p>
  );
}

/** "Why" popover: Qloo's evidence on top, Mise's interpretation below, never mixed. */
export function Why({
  label,
  name,
  qloo,
  read,
  writtenBy,
}: {
  label: string;
  name: string;
  qloo: QlooEvidence;
  read: { term: string; text: string }[];
  writtenBy: ProducedBy;
}) {
  const id = useId();
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className="self-start rounded-sm text-xs text-dim underline decoration-line underline-offset-4 hover:text-paper hover:decoration-dim"
      >
        {label}
        <span className="sr-only">: {name}</span>
      </button>
      <div id={id} popover="auto" className="why" role="dialog" aria-label={`Why ${name}`}>
        <p className="text-lg font-semibold leading-snug">{name}</p>
        <section className="mt-4">
          <h3 className="font-mono text-xs text-tungsten">From Qloo</h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs text-paper/90">
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
        <button
          type="button"
          popoverTarget={id}
          popoverTargetAction="hide"
          className="mt-5 rounded-sm px-3 py-1.5 text-sm ring-1 ring-line hover:ring-dim"
        >
          Close
        </button>
      </div>
    </>
  );
}
