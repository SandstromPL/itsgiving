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
    const data = new FormData(event.currentTarget);
    onPick(Object.fromEntries(items.map((item) => [item.key, String(data.get(item.key) ?? "")])));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 rounded-lg border border-line bg-graphite/60 p-5 sm:p-6">
      <div>
        <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold text-paper focus:outline-none">
          Which one do you mean?
        </h2>
        <p className="mt-1 text-sm text-dim">{message}</p>
      </div>
      {items.map((item) => (
        <fieldset key={item.key} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm text-paper">
            &ldquo;{item.input}&rdquo;, from {ROLE[item.role]}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {item.candidates.map((candidate, i) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-center gap-3 rounded-md p-2 ring-1 ring-line hover:ring-stone-600 has-checked:ring-2 has-checked:ring-paper has-focus-visible:outline-2 has-focus-visible:outline-tungsten"
              >
                <input type="radio" name={item.key} value={candidate.id} required defaultChecked={i === 0} className="sr-only" />
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
        disabled={running}
        className="self-start rounded-md bg-paper px-4 py-2 text-sm font-semibold text-ink hover:bg-white disabled:opacity-60"
      >
        Continue with these
      </button>
    </form>
  );
}
