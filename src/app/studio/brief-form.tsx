"use client";

import { useEffect, useId, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from "react";
import type { Example } from "@/lib/agent/examples";
import {
  BUDGETS,
  FORMATS,
  IMPORT_LIMIT,
  THINKING,
  TMDB_NOTICE,
  withYear,
  type Budget,
  type Format,
  type Thinking,
} from "@/lib/agent/options";
import type { TasteImport } from "@/lib/agent/taste";
import {
  LIMITS,
  addFilm,
  exampleChip,
  looksLikeImport,
  removeFilm,
  splitTitles,
  type FieldName,
  type FormProblem,
  type FormState,
} from "./form";
import { useLingo } from "./lingo";

const field =
  "w-full rounded-2xl border border-edge bg-field px-4 py-3 text-[17px] text-foreground placeholder:text-faint hover:border-foreground focus:border-foreground aria-invalid:border-2 aria-invalid:border-safelight";
const label = "text-[13px] font-medium text-dim";
const hint = "text-[13px] leading-5 text-faint";
/** A two-way switch: the chosen side is a solid pill inside a soft track. */
const track = "grid grid-cols-2 gap-1 rounded-full bg-track p-1";
const option =
  "press cursor-pointer rounded-full px-3 py-2.5 text-center text-[15px] text-dim hover:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground";
const chip = "flex items-center gap-0.5 rounded-full border border-line bg-card py-0.5 pr-0.5 pl-3 text-[13px]";

/** A labelled field: the label, then whatever the field holds (its control, a hint, its message). */
function Field({ id, label: text, children }: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={label}>
        {text}
      </label>
      {children}
    </div>
  );
}

/** A choice of two as a switch: radios named `name`, the chosen one a solid pill. */
function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  describedBy,
}: {
  name: string;
  value: T;
  options: [T, ReactNode][];
  onChange: (value: T) => void;
  describedBy?: string;
}) {
  return (
    <div className={track}>
      {options.map(([key, text]) => (
        <label
          key={key}
          className={`${option} has-checked:bg-foreground has-checked:font-bold has-checked:text-background has-checked:hover:text-background`}
        >
          <input
            type="radio"
            name={name}
            value={key}
            checked={value === key}
            onChange={() => onChange(key)}
            aria-describedby={describedBy}
            className="sr-only"
          />
          {text}
        </label>
      ))}
    </div>
  );
}

/** A field's accessibility wiring: marked invalid and pointed at the message when it is the one failing. */
type Describe = (name: FieldName, hint?: string) => { "aria-invalid"?: boolean; "aria-describedby"?: string };

const filmName = (film: { title: string; year?: number }) => withYear(film.title, film.year);

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

function RemoveButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-full text-dim hover:bg-field hover:text-foreground"
    >
      <span aria-hidden>×</span>
    </button>
  );
}

/**
 * Your taste in one place: films you type, and films imported from a public TMDB list or IMDb links (each looked up
 * in Qloo by its IMDb ID, so nothing is guessed). Both show as chips; the brief carries the titles and the IDs.
 */
function TasteField({
  form,
  onChange,
  describe,
  message,
}: {
  form: FormState;
  onChange: Dispatch<SetStateAction<FormState>>;
  describe: Describe;
  message: (name: FieldName) => ReactNode;
}) {
  const ids = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const typed = splitTitles(form.directorFilms);
  const count = typed.length + form.imported.length;

  const importFrom = async (source: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/taste", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<TasteImport> & { error?: string };
      if (!response.ok || !body.found || !body.source) {
        setError(body.error ?? "The import failed. Try again.");
        return;
      }
      const result = body as TasteImport;
      // An update, not a snapshot: the import lands seconds later, after any edits made meanwhile.
      onChange((current) => ({
        ...current,
        imported: result.found,
        importedFrom: result.source.kind === "tmdb" ? `the TMDB list “${result.source.name}”` : "IMDb links",
      }));
      setStatus(importSummary(result));
      setText("");
    } catch {
      setError("Couldn't reach itsgiving. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const value = text.trim();
    if (busy || !value) return;
    setError("");
    setStatus("");
    if (looksLikeImport(value)) {
      void importFrom(value);
      return;
    }
    if (value.length > LIMITS.name) {
      setError(`Each title must be under ${LIMITS.name} characters.`);
      return;
    }
    if (typed.length >= LIMITS.directorFilms) {
      setError(`Type up to ${LIMITS.directorFilms} films, or import a list for up to ${IMPORT_LIMIT}.`);
      return;
    }
    onChange((current) => addFilm(current, value));
    setText("");
    setStatus(`Added ${value}.`);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${ids}-taste`} className={label}>
        Your taste{count > 0 ? `: ${count} film${count === 1 ? "" : "s"}` : ""}
      </label>
      {count > 0 && (
        <ul aria-label="Films you love" className="mb-1 flex flex-wrap gap-1.5">
          {typed.map((title) => (
            <li key={`typed-${title}`} className={chip}>
              {title}
              <RemoveButton name={title} onClick={() => onChange((current) => removeFilm(current, title))} />
            </li>
          ))}
          {form.imported.map((film) => (
            <li key={film.imdb} className={chip}>
              {filmName(film)}
              <RemoveButton
                name={filmName(film)}
                onClick={() => onChange((current) => ({ ...current, imported: current.imported.filter((f) => f.imdb !== film.imdb) }))}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id={`${ids}-taste`}
          className={`${field} min-w-0 flex-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the film; it must not submit the brief around it.
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. In the Mood for Love"
          autoComplete="off"
          spellCheck={false}
          {...describe("directorFilms", `${ids}-taste-hint`)}
        />
        <button
          type="button"
          onClick={add}
          aria-disabled={busy || !text.trim()}
          className="shrink-0 rounded-2xl border border-foreground bg-card px-4 text-[15px] font-bold hover:bg-foreground hover:text-background aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-card aria-disabled:hover:text-foreground"
        >
          {busy ? "Importing…" : looksLikeImport(text) ? "Import" : "Add"}
        </button>
      </div>
      <p id={`${ids}-taste-hint`} className={hint}>
        Feature films you love, one at a time, or paste a public TMDB list or IMDb links (up to {IMPORT_LIMIT}). Add the year, like Rockstar
        (2011), when titles repeat. Qloo doesn&apos;t list short films, your own included.{" "}
        {form.imported.length > 0 && `Imported from ${form.importedFrom}. `}
        {TMDB_NOTICE}
      </p>
      <p role="status" className="text-[13px] leading-5 text-dim empty:hidden">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-safelight">
          {error}
        </p>
      )}
      {message("directorFilms")}
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
  examples = [],
  onExample,
}: {
  form: FormState;
  onChange: Dispatch<SetStateAction<FormState>>;
  onSubmit: () => void;
  onStop: () => void;
  running: boolean;
  problem: FormProblem | null;
  /** Briefs to fill the form with, as chips at the top. */
  examples?: Example[];
  onExample?: (example: Example) => void;
}) {
  const ids = useId();
  const { t } = useLingo();
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => onChange({ ...form, [key]: value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!running) onSubmit();
  };
  const isVideo = form.format === "music_video";
  const errorId = `${ids}-problem`;
  /** The failing field gets aria-invalid and points at the message; the others keep their hints. */
  const describe: Describe = (name, hint) => ({
    "aria-invalid": problem?.field === name ? true : undefined,
    "aria-describedby": [problem?.field === name ? errorId : undefined, hint].filter(Boolean).join(" ") || undefined,
  });
  const message = (name: FieldName) =>
    problem?.field === name ? (
      <p id={errorId} role="alert" className="text-sm font-medium text-safelight">
        {problem.message}
      </p>
    ) : null;

  // The optional extras sit in a drawer. A music video starts from its artist, a short film from the films it's after;
  // the other one is an extra.
  const extras =
    (isVideo ? splitTitles(form.touchstones).length + splitTitles(form.standIns).length : form.artist.trim() ? 1 : 0) +
    splitTitles(form.directorFilms).length +
    form.imported.length;
  const [drawerOpen, setDrawerOpen] = useState(extras > 0);
  // A problem inside the drawer keeps it open, so the message is never hidden.
  const drawerHasProblem =
    problem?.field === "directorFilms" ||
    (isVideo ? problem?.field === "touchstones" || problem?.field === "standIns" : problem?.field === "artist");
  const open = drawerOpen || drawerHasProblem;

  // A problem takes focus to its field, which may be in the drawer it just opened (a run can fail on the stand-ins).
  useEffect(() => {
    if (problem) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [problem]);

  const artist = (
    <Field id={`${ids}-artist`} label={isVideo ? "Artist" : "Music its audience loves (optional)"}>
      <input
        id={`${ids}-artist`}
        className={field}
        value={form.artist}
        onChange={(e) => set("artist", e.target.value)}
        placeholder="e.g. Prateek Kuhad"
        autoComplete="off"
        {...describe("artist", isVideo ? undefined : `${ids}-artist-hint`)}
      />
      {!isVideo && (
        <p id={`${ids}-artist-hint`} className={hint}>
          An artist whose fans your short is for, if any. It shapes the audience, not the story.
        </p>
      )}
      {message("artist")}
    </Field>
  );

  const standIns = (
    <Field id={`${ids}-standins`} label="Stand-in artists (optional)">
      <textarea
        id={`${ids}-standins`}
        className={`${field} resize-y`}
        rows={2}
        value={form.standIns}
        onChange={(e) => set("standIns", e.target.value)}
        placeholder={"e.g. Seedhe Maut\nPrabh Deep"}
        {...describe("standIns", `${ids}-standins-hint`)}
      />
      <p id={`${ids}-standins-hint`} className={hint}>
        Only used if Qloo doesn&apos;t have your artist: up to {LIMITS.standIns} artists with a similar audience, one per line. Their fans
        carry the audience, and the treatment keeps your artist&apos;s name.
      </p>
      {message("standIns")}
    </Field>
  );

  const touchstones = (
    <Field id={`${ids}-touchstones`} label={isVideo ? "Reference films (optional)" : "Films it's after"}>
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
        {isVideo
          ? `One title per line, up to ${LIMITS.touchstones}. The client's references, if any.`
          : `One title per line, up to ${LIMITS.touchstones}. They define your short's audience.`}{" "}
        Feature films only: Qloo doesn&apos;t list short films.
      </p>
      {message("touchstones")}
    </Field>
  );

  return (
    <form
      ref={formRef}
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
        <Segmented
          name="format"
          value={form.format}
          options={(Object.keys(FORMATS) as Format[]).map((format) => [format, FORMATS[format]])}
          onChange={(format) => set("format", format)}
        />
      </fieldset>

      {isVideo ? artist : touchstones}

      <Field id={`${ids}-city`} label="Shoot city">
        <input
          id={`${ids}-city`}
          className={field}
          value={form.city}
          onChange={(e) => set("city", e.target.value)}
          placeholder="e.g. Mumbai"
          autoComplete="address-level2"
          {...describe("city")}
        />
      </Field>
      {message("city")}

      <div className="overflow-hidden rounded-[20px] border border-line">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${ids}-drawer`}
          onClick={() => setDrawerOpen(!open)}
          className="flex min-h-15 w-full items-center justify-between gap-3 bg-field px-4 py-3 text-left hover:bg-track"
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-[16px] font-bold">{t.makeItYours}</span>
            <span className="text-[13px] text-faint">
              {isVideo
                ? "Reference films, stand-in artists, your taste, budget, thinking"
                : "Music its audience loves, your taste, budget, thinking"}
            </span>
          </span>
          <span className="flex items-center gap-2.5">
            {extras > 0 && (
              <span className="rounded-full bg-foreground px-2.5 py-1 text-[12px] font-bold text-background">{extras} added</span>
            )}
            <svg
              aria-hidden
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        </button>
        <div id={`${ids}-drawer`} hidden={!open} className="flex flex-col gap-4 border-t border-line p-4">
          {isVideo ? (
            <>
              {touchstones}
              {standIns}
            </>
          ) : (
            artist
          )}
          <TasteField form={form} onChange={onChange} describe={describe} message={message} />
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
          <fieldset className="flex flex-col gap-1.5">
            <legend className={`mb-1.5 ${label}`}>Thinking</legend>
            <Segmented
              name="thinking"
              value={form.thinking}
              options={(Object.keys(THINKING) as Thinking[]).map((thinking) => [thinking, t.thinking[thinking]])}
              onChange={(thinking) => set("thinking", thinking)}
              describedBy={`${ids}-thinking-hint`}
            />
            <p id={`${ids}-thinking-hint`} className={hint}>
              {THINKING[form.thinking].label} thinking:{" "}
              {THINKING[form.thinking].hint.charAt(0).toLowerCase() + THINKING[form.thinking].hint.slice(1)}
            </p>
          </fieldset>
        </div>
      </div>

      <div className="mt-1 flex gap-2">
        {/* aria-disabled, not disabled: the button keeps focus while the run it started is going. */}
        <button
          type="submit"
          aria-disabled={running}
          className="h-14 flex-1 rounded-full bg-foreground px-5 text-[18px] font-bold text-background hover:opacity-90 aria-disabled:cursor-progress aria-disabled:opacity-60"
        >
          {running ? "Building treatment…" : "Build treatment"}
        </button>
        {running && (
          <button type="button" onClick={onStop} className="h-14 rounded-full border border-foreground px-5 text-[16px] font-semibold">
            Stop
          </button>
        )}
      </div>

      {examples.length > 0 && onExample && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className={label}>{t.tryOne}</p>
          <ul aria-label={t.tryOne} className="flex flex-wrap gap-1.5">
            {examples.map((example) => (
              <li key={example.slug}>
                <button
                  type="button"
                  onClick={() => onExample(example)}
                  title={example.detail}
                  className="min-h-9 rounded-full border border-edge bg-card px-3.5 text-[14px] font-semibold hover:border-foreground hover:bg-field"
                >
                  {exampleChip(example.brief)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}
