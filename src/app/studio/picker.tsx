"use client";

import { useEffect, useRef, type FormEvent } from "react";
import { NONE_PICK } from "@/lib/agent/options";
import type { Ambiguity, Role } from "@/lib/agent/types";
import { useLingo } from "./lingo";
import { Still } from "./parts";

const ROLE: Record<Role, string> = {
  artist: "the artist",
  touchstone: "your films",
  director: "your taste",
  stand_in: "your stand-in artists",
};

const optionCard =
  "group flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-line bg-card p-2.5 hover:border-edge has-checked:border-foreground has-checked:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground";

/**
 * Asks which entity a name means instead of guessing; only Qloo's own candidates can be picked. When none has the name
 * as typed they are only Qloo's nearest names, so it says so and offers "None of these".
 */
export function Picker({
  message,
  items,
  onPick,
  running,
}: {
  message: string;
  items: Ambiguity[];
  onPick: (picks: Record<string, string>) => void;
  running: boolean;
}) {
  const { t } = useLingo();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running) return;
    const data = new FormData(event.currentTarget);
    onPick(Object.fromEntries(items.map((item) => [item.key, String(data.get(item.key) ?? "")])));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-7 rounded-[28px] border border-line bg-card p-6 sm:p-8">
      <div>
        <h2 ref={heading} tabIndex={-1} className="type-poster text-[clamp(2.5rem,5vw,3.75rem)] focus:outline-none">
          {t.pickTitle}
        </h2>
        <p className="mt-3 text-[16px] leading-6 text-dim">{message}</p>
      </div>
      {items.map((item) => (
        <fieldset key={item.key} className="flex flex-col gap-2">
          <legend className="mb-2 text-[15px] font-semibold">
            &ldquo;{item.input}&rdquo;, from {ROLE[item.role]}
          </legend>
          {!item.exact && (
            <p className="-mt-1 mb-1 text-[14px] leading-5 text-dim">Qloo has nothing under this exact name. These are its nearest:</p>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {item.candidates.map((candidate) => (
              <label key={candidate.id} className={optionCard}>
                <input type="radio" name={item.key} value={candidate.id} required className="sr-only" />
                <Still src={candidate.image} alt="" className="aspect-video w-20 shrink-0 rounded-lg" />
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-bold text-foreground group-has-checked:text-[#121211]">
                    {candidate.name}
                  </span>
                  <span className="block truncate text-[13px] text-dim group-has-checked:text-[#4a4741]">
                    {[candidate.disambiguation ?? candidate.year, candidate.kind?.replace("_", " ")].filter(Boolean).join(", ")}
                  </span>
                </span>
              </label>
            ))}
            {!item.exact && (
              <label className={optionCard}>
                <input type="radio" name={item.key} value={NONE_PICK} required className="sr-only" />
                <span className="grid aspect-video w-20 shrink-0 place-items-center rounded-lg bg-field text-[22px] text-dim" aria-hidden>
                  ×
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-bold text-foreground group-has-checked:text-[#121211]">None of these</span>
                  <span className="block text-[13px] text-dim group-has-checked:text-[#4a4741]">
                    {item.role === "artist" ? "They aren't in Qloo" : "Leave it out"}
                  </span>
                </span>
              </label>
            )}
          </div>
        </fieldset>
      ))}
      <button
        type="submit"
        aria-disabled={running}
        className="h-14 self-start rounded-full bg-foreground px-6 text-[17px] font-bold text-background aria-disabled:opacity-60"
      >
        Continue with these
      </button>
    </form>
  );
}
