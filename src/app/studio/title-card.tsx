"use client";

import { useId } from "react";
import { useLingo } from "./lingo";
import { TITLE_FONTS, titleFont, type TitleFont } from "./title-fonts";

/** The cover's "Title card" button and the window it opens: pick a face, see the cover change behind it. */
export function TitleCardPicker({
  title,
  fontId,
  suggestion,
  onPick,
}: {
  title: string;
  fontId: string;
  suggestion: { id: string; why: string };
  onPick: (id: string) => void;
}) {
  const id = useId();
  const { t: lines, unc } = useLingo();
  const current = titleFont(fontId);
  const suggested = titleFont(suggestion.id);
  const label = (f: TitleFont) => (unc ? f.plain : f.name);
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-bold text-[#121211] print:hidden"
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
      <div id={id} popover="auto" className="window" role="dialog" aria-labelledby={`${id}-title`}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b-2 border-[#121211] bg-[#f7f5f0] py-1 pr-1 pl-4">
          <span aria-hidden className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border-2 border-[#121211]" />
            <span className="size-2.5 rounded-full border-2 border-[#121211]" />
            <span className="size-2.5 rounded-full border-2 border-[#121211] bg-[#121211]" />
          </span>
          <span className="font-mono text-[13px] text-[#2b2925]">title card</span>
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            aria-label="Close"
            className="grid size-11 place-items-center rounded-xl text-[#121211] hover:bg-[#eeebe4]"
          >
            <svg
              aria-hidden
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {/* Only the faces scroll: the window's bar (Close) and Done stay in view, on a phone too. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex flex-col gap-3 px-5 pt-5">
            <h2 id={`${id}-title`} className="type-head text-[2.1rem] leading-none text-[#121211]">
              {lines.titleWindow}
            </h2>
            <p className="text-[15px] leading-6 text-[#4a4741]">Sets the title in a cinematic face. It carries into the PDF.</p>
            <div className="rounded-xl border border-dashed border-[#c9c1af] bg-[#fffdf6] px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-[#2b2925]">
              <p className="font-semibold">why {label(suggested)} is suggested</p>
              <p>{suggestion.why}</p>
            </div>
          </div>
          <fieldset className="flex flex-col gap-2 px-5 py-4">
            <legend className="sr-only">Title typeface</legend>
            {TITLE_FONTS.map((f) => (
              <label
                key={f.id}
                className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-[#e5e0d5] bg-white px-3.5 py-2.5 text-[#121211] hover:border-[#8c867b] has-checked:border-[#121211] has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-[#121211]"
              >
                <input
                  type="radio"
                  name={`${id}-font`}
                  value={f.id}
                  checked={f.id === fontId}
                  onChange={() => onPick(f.id)}
                  autoFocus={f.id === fontId}
                  className="sr-only"
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate" style={{ ...f.style, fontSize: `max(15px, calc(1.5rem * ${f.scale}))`, lineHeight: 1.15 }}>
                    {title}
                  </span>
                  <span className="text-[13px] text-[#4a4741]">
                    <span className="font-bold text-[#121211]">{label(f)}</span>, {f.evokes}
                  </span>
                </span>
                {f.id === suggestion.id && (
                  <span className="shrink-0 rounded-full border-[1.5px] border-[#121211] bg-white px-2.5 py-1 text-xs font-bold">
                    suggested
                  </span>
                )}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="flex shrink-0 justify-end border-t border-[#dad5ca] px-5 pt-3.5 pb-5">
          <button
            type="button"
            popoverTarget={id}
            popoverTargetAction="hide"
            className="rounded-full bg-[#121211] px-5 py-3 text-[15px] font-bold text-white"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
