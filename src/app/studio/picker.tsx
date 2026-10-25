"use client";

import { useEffect, useRef, type FormEvent } from "react";
import type { Ambiguity, Role } from "@/lib/agent/types";
import { Still } from "./parts";

const ROLE: Record<Role, string> = {
  artist: "the artist",
  touchstone: "your touchstones",
  director: "your taste",
};

/** Asks which entity a name means instead of guessing; only Qloo's own candidates can be picked. */
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
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running) return;
    const data = new FormData(event.currentTarget);
    onPick(Object.fromEntries(items.map((item) => [item.key, String(data.get(item.key) ?? "")])));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-7 rounded-lg bg-graphite p-6 ring-1 ring-line sm:p-8">
      <div>
        <h2 ref={heading} tabIndex={-1} className="type-head text-3xl leading-none text-paper focus:outline-none">
          Which one do you mean?
        </h2>
        <p className="mt-2 text-sm leading-6 text-dim">{message}</p>
      </div>
      {items.map((item) => (
        <fieldset key={item.key} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-paper">
            &ldquo;{item.input}&rdquo;, from {ROLE[item.role]}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {item.candidates.map((candidate) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-center gap-3 rounded-md bg-raised p-2 ring-1 ring-edge hover:ring-dim has-checked:ring-2 has-checked:ring-paper has-focus-visible:outline-2 has-focus-visible:outline-tungsten"
              >
                <input type="radio" name={item.key} value={candidate.id} required className="sr-only" />
                <Still src={candidate.image} alt="" className="aspect-video w-20 shrink-0 rounded-sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-paper">{candidate.name}</span>
                  <span className="block truncate text-xs text-dim">
                    {[candidate.disambiguation ?? candidate.year, candidate.kind?.replace("_", " ")].filter(Boolean).join(", ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <button
        type="submit"
        aria-disabled={running}
        className="h-11 self-start rounded-md bg-paper px-5 text-[15px] font-semibold text-ink hover:bg-white aria-disabled:opacity-60"
      >
        Continue with these
      </button>
    </form>
  );
}
