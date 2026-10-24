"use client";

import { useId, type FormEvent } from "react";
import { BUDGETS, FORMATS, type Budget, type Format } from "@/lib/agent/options";

export interface FormState {
  format: Format;
  artist: string;
  touchstones: string;
  city: string;
  budget: Budget;
  directorFilms: string;
}

export const EMPTY_FORM: FormState = {
  format: "music_video",
  artist: "",
  touchstones: "",
  city: "",
  budget: "indie",
  directorFilms: "",
};

/** One title per line (or separated by semicolons); commas stay, since titles like "Paris, Texas" have them. */
export function splitTitles(text: string): string[] {
  return text
    .split(/[\n;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

const field =
  "w-full rounded-md border border-line bg-graphite px-3 py-2 text-sm text-paper placeholder:text-faint hover:border-stone-600 focus:border-tungsten focus:outline-none";

export function BriefForm({
  form,
  onChange,
  onSubmit,
  running,
  problem,
}: {
  form: FormState;
  onChange: (form: FormState) => void;
  onSubmit: () => void;
  running: boolean;
  problem: string | null;
}) {
  const ids = useId();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => onChange({ ...form, [key]: value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const isVideo = form.format === "music_video";

  return (
    <form onSubmit={submit} aria-labelledby={`${ids}-title`} className="flex flex-col gap-5">
      <div>
        <h2 id={`${ids}-title`} className="text-sm font-medium text-paper">
          The brief
        </h2>
        <p className="mt-1 text-xs leading-5 text-dim">Names only. Nothing personal is sent to Qloo.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs text-dim">Format</legend>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-graphite p-1">
          {(Object.keys(FORMATS) as Format[]).map((format) => (
            <label
              key={format}
              className="cursor-pointer rounded px-3 py-1.5 text-center text-sm text-dim has-checked:bg-paper has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-tungsten"
            >
              <input
                type="radio"
                name="format"
                value={format}
                checked={form.format === format}
                onChange={() => set("format", format)}
                className="sr-only"
              />
              {FORMATS[format]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-artist`} className="text-xs text-dim">
          {isVideo ? "Artist" : "Artist or band (optional)"}
        </label>
        <input
          id={`${ids}-artist`}
          className={field}
          value={form.artist}
          onChange={(e) => set("artist", e.target.value)}
          placeholder="Prateek Kuhad"
          autoComplete="off"
          maxLength={80}
          aria-describedby={problem ? `${ids}-problem` : undefined}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-touchstones`} className="text-xs text-dim">
          Touchstone films {isVideo ? "(optional)" : ""}
        </label>
        <textarea
          id={`${ids}-touchstones`}
          className={`${field} resize-y`}
          rows={2}
          value={form.touchstones}
          onChange={(e) => set("touchstones", e.target.value)}
          placeholder={"Past Lives\nAftersun"}
          aria-describedby={`${ids}-touchstones-hint`}
        />
        <p id={`${ids}-touchstones-hint`} className="text-xs text-faint">
          One title per line. The client&apos;s references, if any.
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-city`} className="text-xs text-dim">
            Shoot city
          </label>
          <input
            id={`${ids}-city`}
            className={field}
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Mumbai"
            required
            maxLength={80}
            autoComplete="address-level2"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-budget`} className="text-xs text-dim">
            Budget
          </label>
          <select
            id={`${ids}-budget`}
            className={field}
            value={form.budget}
            onChange={(e) => set("budget", e.target.value as Budget)}
          >
            {(Object.keys(BUDGETS) as Budget[]).map((budget) => (
              <option key={budget} value={budget}>
                {BUDGETS[budget].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-taste`} className="text-xs text-dim">
          Your taste (optional)
        </label>
        <textarea
          id={`${ids}-taste`}
          className={`${field} resize-y`}
          rows={3}
          value={form.directorFilms}
          onChange={(e) => set("directorFilms", e.target.value)}
          placeholder={"In the Mood for Love\nDonnie Darko"}
          aria-describedby={`${ids}-taste-hint`}
        />
        <p id={`${ids}-taste-hint`} className="text-xs text-faint">
          Films you love, one per line. Mise finds where your taste meets the audience&apos;s.
        </p>
      </div>

      {problem && (
        <p id={`${ids}-problem`} role="alert" className="text-sm text-safelight">
          {problem}
        </p>
      )}

      <button
        type="submit"
        disabled={running}
        className="rounded-md bg-paper px-4 py-2.5 text-sm font-semibold text-ink hover:bg-white disabled:cursor-progress disabled:opacity-60"
      >
        {running ? "Building treatment…" : "Build treatment"}
      </button>
    </form>
  );
}
