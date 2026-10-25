"use client";

import { useId, type FormEvent } from "react";
import { BUDGETS, FORMATS, THINKING, type Budget, type Format, type Thinking } from "@/lib/agent/options";

export interface FormState {
  format: Format;
  artist: string;
  touchstones: string;
  city: string;
  budget: Budget;
  directorFilms: string;
  thinking: Thinking;
}

export const EMPTY_FORM: FormState = {
  format: "music_video",
  artist: "",
  touchstones: "",
  city: "",
  budget: "indie",
  directorFilms: "",
  thinking: "deep",
};

/** The server's limits (src/lib/agent/brief.ts), checked here so nothing is dropped or rejected silently. */
export const LIMITS = { touchstones: 5, directorFilms: 8, name: 80 } as const;

/** One title per line (or separated by semicolons); commas stay, since titles like "Paris, Texas" have them. */
export function splitTitles(text: string): string[] {
  return text
    .split(/[\n;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export type FieldName = "artist" | "touchstones" | "city" | "directorFilms";
export interface FormProblem {
  field: FieldName;
  message: string;
}

/** Client-side check of a brief, in the order a director reads the form. */
export function validateForm(form: FormState): FormProblem | null {
  const touchstones = splitTitles(form.touchstones);
  const films = splitTitles(form.directorFilms);
  const tooLong = (titles: string[]) => titles.find((t) => t.length > LIMITS.name);
  if (form.artist.trim().length > LIMITS.name) return { field: "artist", message: `Keep the artist name under ${LIMITS.name} characters.` };
  if (!form.artist.trim() && touchstones.length === 0) {
    return { field: "artist", message: "Add an artist or at least one touchstone film." };
  }
  if (touchstones.length > LIMITS.touchstones) {
    return { field: "touchstones", message: `Use up to ${LIMITS.touchstones} touchstone films; you have ${touchstones.length}.` };
  }
  if (tooLong(touchstones)) return { field: "touchstones", message: `Each title must be under ${LIMITS.name} characters.` };
  if (!form.city.trim()) return { field: "city", message: "Add the shoot city." };
  if (form.city.trim().length > LIMITS.name) return { field: "city", message: `Keep the city under ${LIMITS.name} characters.` };
  if (films.length > LIMITS.directorFilms) {
    return { field: "directorFilms", message: `Use up to ${LIMITS.directorFilms} of your films; you have ${films.length}.` };
  }
  if (tooLong(films)) return { field: "directorFilms", message: `Each title must be under ${LIMITS.name} characters.` };
  return null;
}

const field =
  "w-full rounded-md border border-edge bg-raised px-3 py-2.5 text-[15px] text-paper placeholder:text-faint hover:border-dim focus:border-tungsten aria-invalid:border-safelight";
const label = "text-[13px] font-medium text-dim";

export function BriefForm({
  form,
  onChange,
  onSubmit,
  onStop,
  running,
  problem,
}: {
  form: FormState;
  onChange: (form: FormState) => void;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  problem: FormProblem | null;
}) {
  const ids = useId();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => onChange({ ...form, [key]: value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!running) onSubmit();
  };
  const isVideo = form.format === "music_video";
  const errorId = `${ids}-problem`;
  /** The failing field gets aria-invalid and points at the message; the others keep their hints. */
  const describe = (name: FieldName, hint?: string) => ({
    "aria-invalid": problem?.field === name ? true : undefined,
    "aria-describedby": [problem?.field === name ? errorId : undefined, hint].filter(Boolean).join(" ") || undefined,
  });
  const message = (name: FieldName) =>
    problem?.field === name ? (
      <p id={errorId} role="alert" className="text-sm text-safelight">
        {problem.message}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} aria-labelledby={`${ids}-title`} className="flex flex-col gap-5" noValidate>
      <div>
        <h2 id={`${ids}-title`} className="type-head text-2xl text-paper">
          The brief
        </h2>
        <p className="mt-1 text-xs leading-5 text-dim">Names of public works only. Nothing personal goes to Qloo or the language model.</p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={`mb-2 ${label}`}>Format</legend>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-frame p-1 ring-1 ring-line">
          {(Object.keys(FORMATS) as Format[]).map((format) => (
            <label
              key={format}
              className="cursor-pointer rounded-md px-3 py-2 text-center text-sm text-dim hover:text-paper has-checked:bg-paper has-checked:font-medium has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-tungsten"
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
        <label htmlFor={`${ids}-artist`} className={label}>
          {isVideo ? "Artist" : "Artist or band (optional)"}
        </label>
        <input
          id={`${ids}-artist`}
          className={field}
          value={form.artist}
          onChange={(e) => set("artist", e.target.value)}
          placeholder="Prateek Kuhad"
          autoComplete="off"
          {...describe("artist")}
        />
        {message("artist")}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-touchstones`} className={label}>
          Touchstone films {isVideo ? "(optional)" : ""}
        </label>
        <textarea
          id={`${ids}-touchstones`}
          className={`${field} resize-y`}
          rows={2}
          value={form.touchstones}
          onChange={(e) => set("touchstones", e.target.value)}
          placeholder={"Past Lives\nAftersun"}
          {...describe("touchstones", `${ids}-touchstones-hint`)}
        />
        <p id={`${ids}-touchstones-hint`} className="text-xs leading-5 text-faint">
          One title per line, up to {LIMITS.touchstones}. The client&apos;s references, if any.
        </p>
        {message("touchstones")}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-city`} className={label}>
            Shoot city
          </label>
          <input
            id={`${ids}-city`}
            className={field}
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="Mumbai"
            autoComplete="address-level2"
            {...describe("city")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-budget`} className={label}>
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
      {message("city")}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-taste`} className={label}>
          Your taste (optional)
        </label>
        <textarea
          id={`${ids}-taste`}
          className={`${field} resize-y`}
          rows={3}
          value={form.directorFilms}
          onChange={(e) => set("directorFilms", e.target.value)}
          placeholder={"In the Mood for Love\nDonnie Darko"}
          {...describe("directorFilms", `${ids}-taste-hint`)}
        />
        <p id={`${ids}-taste-hint`} className="text-xs leading-5 text-faint">
          Films you love, one per line, up to {LIMITS.directorFilms}. Add the year, like Rockstar (2011), to skip a
          question when titles repeat. Mise finds where your taste meets the audience&apos;s.
        </p>
        {message("directorFilms")}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={`mb-2 ${label}`}>Thinking</legend>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-frame p-1 ring-1 ring-line">
          {(Object.keys(THINKING) as Thinking[]).map((thinking) => (
            <label
              key={thinking}
              className="cursor-pointer rounded-md px-3 py-2 text-center text-sm text-dim hover:text-paper has-checked:bg-paper has-checked:font-medium has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-tungsten"
            >
              <input
                type="radio"
                name="thinking"
                value={thinking}
                checked={form.thinking === thinking}
                onChange={() => set("thinking", thinking)}
                aria-describedby={`${ids}-thinking-hint`}
                className="sr-only"
              />
              {THINKING[thinking].label}
            </label>
          ))}
        </div>
        <p id={`${ids}-thinking-hint`} className="text-xs leading-5 text-faint">
          {THINKING[form.thinking].hint}
        </p>
      </fieldset>

      <div className="flex gap-2">
        {/* aria-disabled, not disabled: the button keeps focus while the run it started is going. */}
        <button
          type="submit"
          aria-disabled={running}
          className="h-11 flex-1 rounded-md bg-paper px-4 text-[15px] font-semibold text-ink hover:bg-white aria-disabled:cursor-progress aria-disabled:opacity-60"
        >
          {running ? "Building treatment…" : "Build treatment"}
        </button>
        {running && (
          <button type="button" onClick={onStop} className="h-11 rounded-md px-4 text-[15px] text-paper ring-1 ring-edge hover:ring-dim">
            Stop
          </button>
        )}
      </div>
    </form>
  );
}
