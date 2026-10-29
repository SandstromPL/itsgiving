"use client";

import { useId, useRef } from "react";
import { tmdbSize } from "@/lib/agent/options";
import { ERAS, ERA_LINES, eraName, type EraId, type EraSuggestion } from "./eras";
import { useLingo } from "./lingo";
import { TITLE_FONTS, titleFont, type TitleFont } from "./title-fonts";
import { CheckIcon } from "./icons";
import { PaperWindow } from "./paper-window";
import { rankMark, slip } from "./ui";

/** A reference film's still that can be the cover: the film's entity ID, its name, and the still itself. */
export interface CoverStill {
  id: string;
  name: string;
  src: string;
}

/** The cover's era (eras.ts): the one worn, the one Qloo's audience points to, and the way to pick. */
export interface EraPick {
  id: EraId | null;
  suggestion?: EraSuggestion;
  /** Why none is suggested, when Qloo's film subgenres were read and none of the eras' traditions is among them. */
  none?: string;
  /** The subgenres came from the synthetic mock, so the receipt is pink, never Qloo's. */
  mock: boolean;
  /** `moment`: whether the era's moment plays, only for a pick made with a pointer (arrowing through is browsing). */
  onPick: (id: EraId | null, moment: boolean) => void;
  /** Whether the latest pick plays its moment. */
  moment: boolean;
}

const check = <CheckIcon size={14} />;

/**
 * The cover's "Title card" button and the window it opens: pick an era for the cover, the still behind the title (a
 * frame from one of the reference films) and the title's face, and see the cover change behind it.
 */
export function TitleCardPicker({
  title,
  fontId,
  suggestion,
  onPick,
  stills,
  stillId,
  onPickStill,
  era,
}: {
  title: string;
  fontId: string;
  suggestion: { id: string; why: string };
  onPick: (id: string) => void;
  stills: CoverStill[];
  stillId?: string;
  onPickStill: (id: string) => void;
  era: EraPick;
}) {
  const id = useId();
  const { t: lines, unc } = useLingo();
  const current = titleFont(fontId);
  const suggested = titleFont(suggestion.id);
  const label = (f: TitleFont) => (unc ? f.plain : f.name);
  const eraLines = unc ? ERA_LINES.unc : ERA_LINES.genz;
  const eraReceipt = slip(era.mock);
  // Arrow keys move through the eras one change at a time; only a pick made with a pointer plays the era's moment. A
  // key press clears a press that changed nothing (on the era already picked).
  const pointer = useRef(false);
  const pickEra = (next: EraId | null) => {
    era.onPick(next, pointer.current);
    pointer.current = false;
  };
  const eraOption =
    "press flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-[#e5e0d5] bg-white px-3.5 py-2 text-ink hover:border-edge has-checked:border-ink has-checked:bg-field has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink";
  const picked = <span className="ml-auto grid size-6 shrink-0 place-items-center rounded-full bg-ink text-white">{check}</span>;
  return (
    <>
      {/* The surface's ink (light on the dark cover): lime is kept for what Qloo found. A faint ring keeps its edge on a
          pale frame. */}
      <button
        type="button"
        popoverTarget={id}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-small leading-5 font-bold text-background ring-1 ring-black/25 print:hidden"
      >
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        >
          <path d="M4 7V4h16v3M9 20h6M12 4v16" />
        </svg>
        Title card: {label(current)}
      </button>
      <PaperWindow id={id} label="title card">
        <div className="flex flex-col gap-3 px-5 pt-5">
          <h2 id={`${id}-title`} className="type-head text-heading leading-none text-ink">
            {lines.titleWindow}
          </h2>
          <p className="text-ui leading-6 text-dim">
            The cover&apos;s era, the still behind the title and the face it&apos;s set in. All three carry into the PDF.
          </p>
        </div>
        {/* An era is a film tradition's look over the cover. Picking one also sets its face, which stays the
              director's to change below. The one the audience points to carries Qloo's receipt. */}
        <fieldset className="mt-5 flex flex-col gap-2 px-5" onKeyDown={() => (pointer.current = false)}>
          <legend className="mb-2.5 text-small font-semibold text-dim">{eraLines.legend}</legend>
          {era.suggestion ? (
            <div className={`mb-1 rounded-xl border border-dashed px-3 py-2.5 font-mono text-label leading-[1.6] ${eraReceipt}`}>
              <p className="font-semibold">why {eraName(era.suggestion.era, unc)} is suggested</p>
              <p>
                {era.mock ? "The mock" : "Qloo"} ranks {era.suggestion.tag.name}{" "}
                <span className={`px-1 ${rankMark(era.mock)}`}>
                  {era.suggestion.tag.rank} of {era.suggestion.tag.of}
                </span>{" "}
                film subgenres for this audience
                {typeof era.suggestion.tag.affinity === "number" && ` (affinity ${era.suggestion.tag.affinity.toFixed(3)})`}
              </p>
            </div>
          ) : (
            era.none && <p className="mb-1 text-caption leading-5 text-dim">{era.none}</p>
          )}
          <label className={eraOption} onPointerDown={() => (pointer.current = true)}>
            <input
              type="radio"
              name={`${id}-era`}
              value=""
              checked={era.id === null}
              onChange={() => pickEra(null)}
              autoFocus={era.id === null}
              className="sr-only"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-ui font-bold">{eraLines.none}</span>
              <span className="text-caption leading-5 text-dim">{eraLines.noneEvokes}</span>
            </span>
            {era.id === null && picked}
          </label>
          {ERAS.map((e) => (
            <label key={e.id} className={eraOption} onPointerDown={() => (pointer.current = true)}>
              <input
                type="radio"
                name={`${id}-era`}
                value={e.id}
                checked={era.id === e.id}
                onChange={() => pickEra(e.id)}
                autoFocus={era.id === e.id}
                className="sr-only"
              />
              <span aria-hidden className="flex shrink-0">
                {[e.colors.stickers[0].ground, e.colors.stickers[1].ground, e.colors.tint, e.colors.title].map((hex, i) => (
                  <span key={i} className="-ml-1.5 size-4 rounded-full ring-2 ring-white first:ml-0" style={{ background: hex }} />
                ))}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-ui font-bold">{eraName(e, unc)}</span>
                <span className="text-caption leading-5 text-dim">{e.evokes}</span>
              </span>
              {e.id === era.suggestion?.era.id && era.id !== e.id && (
                <span className="ml-auto shrink-0 rounded-full border-[1.5px] border-ink bg-white px-2.5 py-1 text-label leading-4 font-bold">
                  {eraLines.suggested}
                </span>
              )}
              {era.id === e.id && picked}
            </label>
          ))}
        </fieldset>
        {/* Stills are worth a choice only when there's more than one film to take a frame from. Each group is spaced by a
              margin, not padding: a legend sits on its fieldset's top edge, above any padding. */}
        {stills.length > 1 && (
          <fieldset className="mt-5 flex flex-col px-5">
            <legend className="mb-2.5 text-small font-semibold text-dim">Still, from a reference film</legend>
            <div className="grid grid-cols-3 gap-2">
              {stills.map((s) => (
                <label
                  key={s.id}
                  className="flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-xl p-1 text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
                >
                  <input
                    type="radio"
                    name={`${id}-still`}
                    value={s.id}
                    checked={s.id === stillId}
                    onChange={() => onPickStill(s.id)}
                    className="peer sr-only"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element -- TMDB's own small size; no optimizer config needed */}
                  <img
                    src={tmdbSize(s.src, "w300")}
                    alt=""
                    loading="lazy"
                    className="aspect-video w-full rounded-lg bg-track object-cover ring-ink peer-checked:ring-[3px]"
                  />
                  <span className="truncate text-label leading-tight text-dim peer-checked:font-bold peer-checked:text-ink">{s.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="mt-5 flex flex-col gap-2 px-5 pb-4">
          <legend className="mb-2.5 text-small font-semibold text-dim">Typeface for the title</legend>
          <div className={`mb-1 rounded-xl border border-dashed px-3 py-2.5 font-mono text-label leading-[1.6] ${slip(era.mock)}`}>
            <p className="font-semibold">why {label(suggested)} is suggested</p>
            <p>{suggestion.why}</p>
          </div>
          {TITLE_FONTS.map((f) => (
            <label
              key={f.id}
              className="press flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-[#e5e0d5] bg-white px-3.5 py-2.5 text-ink hover:border-edge has-checked:border-ink has-checked:bg-field has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
            >
              <input
                type="radio"
                name={`${id}-font`}
                value={f.id}
                checked={f.id === fontId}
                onChange={() => onPick(f.id)}
                className="sr-only"
              />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="truncate" style={{ ...f.style, fontSize: `max(15px, calc(1.5rem * ${f.scale}))`, lineHeight: 1.15 }}>
                  {title}
                </span>
                <span className="text-caption text-dim">
                  <span className="font-bold text-ink">{label(f)}</span>, {f.evokes}
                </span>
              </span>
              {f.id === suggestion.id && (
                <span className="shrink-0 rounded-full border-[1.5px] border-ink bg-white px-2.5 py-1 text-label leading-4 font-bold">
                  suggested
                </span>
              )}
            </label>
          ))}
        </fieldset>
      </PaperWindow>
    </>
  );
}
