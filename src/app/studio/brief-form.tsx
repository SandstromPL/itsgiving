"use client";

import { useId, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { BUDGETS, FORMATS, IMPORT_LIMIT, THINKING, TMDB_NOTICE, type Budget, type Format, type Thinking } from "@/lib/agent/options";
import type { ImportedFilm, TasteImport } from "@/lib/agent/taste";
import { LIMITS, type FieldName, type FormProblem, type FormState } from "./form";
import { useLingo } from "./lingo";

const field =
  "w-full rounded-2xl border border-edge bg-field px-4 py-3 text-[17px] text-foreground placeholder:text-faint hover:border-foreground focus:border-foreground aria-invalid:border-2 aria-invalid:border-safelight";
const label = "text-[13px] font-medium text-dim";
const hint = "text-[13px] leading-5 text-faint";
/** A two-way switch: the chosen side is a solid pill inside a soft track. */
const track = "grid grid-cols-2 gap-1 rounded-full bg-[#eeebe4] p-1";
const option =
  "cursor-pointer rounded-full px-3 py-2.5 text-center text-[15px] text-dim hover:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground";

const filmName = (film: { title: string; year?: number }) => `${film.title}${film.year ? ` (${film.year})` : ""}`;

/** One line on what an import brought in and what it left out. */
function importSummary(result: TasteImport): string {
  const read = result.found.length + result.missing.length;
  const from = result.source.kind === "tmdb" ? `“${result.source.name}”` : "your links";
  const parts = [`${result.found.length} of ${read} from ${from} ${result.found.length === 1 ? "is" : "are"} in Qloo.`];
  if (result.source.kind === "tmdb" && result.source.total > read)
    parts.push(`itsgiving read the first ${read} of ${result.source.total}.`);
  if (result.missing.length > 0) {
    const names = result.missing.slice(0, 3).map(filmName).join(", ");
    const more = result.missing.length > 3 ? ` and ${result.missing.length - 3} more` : "";
    parts.push(`Left out: ${names}${more}. Qloo lists feature films and series, not short films.`);
  }
  return parts.join(" ");
}

/**
 * Imports the director's taste from a public TMDB list or IMDb links. The films found in Qloo show as chips; the
 * brief carries their IMDb IDs, so the pipeline looks them up exactly.
 */
function TasteImportField({
  imported,
  from,
  onChange,
}: {
  imported: ImportedFilm[];
  from: string;
  onChange: (imported: ImportedFilm[], from: string) => void;
}) {
  const ids = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const run = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/taste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: text }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<TasteImport> & { error?: string };
      if (!response.ok || !body.found || !body.source) {
        setError(body.error ?? "The import failed. Try again.");
        return;
      }
      const result = body as TasteImport;
      onChange(result.found, result.source.kind === "tmdb" ? `the TMDB list “${result.source.name}”` : "IMDb links");
      setStatus(importSummary(result));
      setText("");
    } catch {
      setError("Couldn't reach itsgiving. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${ids}-import`} className={label}>
        Import your taste (optional)
      </label>
      <div className="flex gap-2">
        <input
          id={`${ids}-import`}
          className={`${field} min-w-0 flex-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter imports; it must not submit the brief around it.
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          placeholder="TMDB list or IMDb links"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={`${ids}-import-hint`}
        />
        <button
          type="button"
          onClick={() => void run()}
          aria-disabled={busy || !text.trim()}
          className="shrink-0 rounded-2xl border border-foreground bg-card px-4 text-[15px] font-bold hover:bg-foreground hover:text-background aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-card aria-disabled:hover:text-foreground"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      <p id={`${ids}-import-hint`} className={hint}>
        A public TMDB list, or IMDb title links, up to {IMPORT_LIMIT} films. itsgiving looks each one up in Qloo by its IMDb ID, so nothing
        is guessed. {TMDB_NOTICE}
      </p>
      <p role="status" className="text-[13px] leading-5 text-dim empty:hidden">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-safelight">
          {error}
        </p>
      )}
      {imported.length > 0 && (
        <div className="rounded-2xl border border-line bg-field p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[13px] text-dim">
              {imported.length} film{imported.length === 1 ? "" : "s"} from {from}
            </p>
            <button
              type="button"
              onClick={() => {
                onChange([], "");
                setStatus("Import cleared.");
              }}
              className="text-[13px] font-semibold underline decoration-edge underline-offset-4 hover:decoration-foreground"
            >
              Clear
            </button>
          </div>
          <ul aria-label="Imported films" className="mt-2 flex flex-wrap gap-1.5">
            {imported.map((film) => (
              <li
                key={film.imdb}
                className="flex items-center gap-0.5 rounded-full border border-line bg-card py-0.5 pr-0.5 pl-3 text-[13px]"
              >
                {filmName(film)}
                <button
                  type="button"
                  aria-label={`Remove ${filmName(film)}`}
                  onClick={() =>
                    onChange(
                      imported.filter((f) => f.imdb !== film.imdb),
                      from,
                    )
                  }
                  className="grid size-6 place-items-center rounded-full text-dim hover:bg-field hover:text-foreground"
                >
                  <span aria-hidden>×</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BriefForm({
  form,
  onChange,
  onSubmit,
  onStop,
  running,
  problem,
}: {
  form: FormState;
  onChange: Dispatch<SetStateAction<FormState>>;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  problem: FormProblem | null;
}) {
  const ids = useId();
  const { t } = useLingo();
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
      <p id={errorId} role="alert" className="text-sm font-medium text-safelight">
        {problem.message}
      </p>
    ) : null;

  return (
    <form
      onSubmit={submit}
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-4 rounded-[28px] border border-line bg-card p-6 sm:p-7"
      noValidate
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`${ids}-title`} className="type-head text-[1.6rem] leading-none">
          The brief
        </h2>
        <p className="text-[13px] text-faint">Nothing personal goes to Qloo</p>
      </div>

      <fieldset>
        <legend className="sr-only">Format</legend>
        <div className={track}>
          {(Object.keys(FORMATS) as Format[]).map((format) => (
            <label
              key={format}
              className={`${option} has-checked:bg-foreground has-checked:font-bold has-checked:text-background has-checked:hover:text-background`}
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
          placeholder="e.g. Prateek Kuhad"
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
          placeholder={"e.g. Past Lives\nAftersun"}
          {...describe("touchstones", `${ids}-touchstones-hint`)}
        />
        <p id={`${ids}-touchstones-hint`} className={hint}>
          One title per line, up to {LIMITS.touchstones}. The client&apos;s references, if any. Feature films only: Qloo doesn&apos;t list
          short films.
        </p>
        {message("touchstones")}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-2.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-city`} className={label}>
            Shoot city
          </label>
          <input
            id={`${ids}-city`}
            className={field}
            value={form.city}
            onChange={(e) => set("city", e.target.value)}
            placeholder="e.g. Mumbai"
            autoComplete="address-level2"
            {...describe("city")}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-budget`} className={label}>
            Budget
          </label>
          <select id={`${ids}-budget`} className={field} value={form.budget} onChange={(e) => set("budget", e.target.value as Budget)}>
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
          placeholder={"e.g. In the Mood for Love\nDonnie Darko"}
          {...describe("directorFilms", `${ids}-taste-hint`)}
        />
        <p id={`${ids}-taste-hint`} className={hint}>
          Feature films you love, one per line, up to {LIMITS.directorFilms}. Add the year, like Rockstar (2011), to skip a question when
          titles repeat. Qloo doesn&apos;t list short films, your own included. itsgiving finds where your taste meets the audience&apos;s.
        </p>
        {message("directorFilms")}
      </div>

      <TasteImportField
        imported={form.imported}
        from={form.importedFrom}
        // An update, not a snapshot: the import lands seconds later, after any edits made meanwhile.
        onChange={(imported, importedFrom) => onChange((current) => ({ ...current, imported, importedFrom }))}
      />

      <fieldset className="flex flex-col gap-1.5">
        <legend className={`mb-1.5 ${label}`}>Thinking</legend>
        <div className={track}>
          {(Object.keys(THINKING) as Thinking[]).map((thinking) => (
            <label
              key={thinking}
              className={`${option} has-checked:bg-card has-checked:font-bold has-checked:text-foreground has-checked:shadow-[0_1px_2px_rgb(0_0_0/0.12)]`}
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
              {t.thinking[thinking]}
            </label>
          ))}
        </div>
        <p id={`${ids}-thinking-hint`} className={hint}>
          {THINKING[form.thinking].label} thinking:{" "}
          {THINKING[form.thinking].hint.charAt(0).toLowerCase() + THINKING[form.thinking].hint.slice(1)}
        </p>
      </fieldset>

      <div className="mt-1 flex gap-2">
        {/* aria-disabled, not disabled: the button keeps focus while the run it started is going. */}
        <button
          type="submit"
          aria-disabled={running}
          className="h-14 flex-1 rounded-full bg-foreground px-5 text-[18px] font-bold text-background hover:bg-[#2b2925] aria-disabled:cursor-progress aria-disabled:opacity-60"
        >
          {running ? "Building treatment…" : "Build treatment"}
        </button>
        {running && (
          <button type="button" onClick={onStop} className="h-14 rounded-full border border-foreground px-5 text-[16px] font-semibold">
            Stop
          </button>
        )}
      </div>
    </form>
  );
}
