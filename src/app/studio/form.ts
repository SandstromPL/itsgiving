import type { BriefInput } from "@/lib/agent/brief";
import { STAND_IN_LIMIT, type Budget, type Format, type Nudge, type Thinking } from "@/lib/agent/options";
import type { ImportedFilm } from "@/lib/agent/taste";

// The brief form's state and the conversions between it and a brief. Kept apart from the component so
// a featured example and the form it fills in are guaranteed to make the same brief (and cache key).

export interface FormState {
  format: Format;
  artist: string;
  /** Artists with a similar audience, one per line: they carry a music video's audience when Qloo lacks the artist. */
  standIns: string;
  touchstones: string;
  city: string;
  budget: Budget;
  directorFilms: string;
  /** Films imported from a TMDB list or IMDb links; the brief carries their IMDb IDs. */
  imported: ImportedFilm[];
  /** Where they came from, for the form: a TMDB list's name, or "IMDb links". */
  importedFrom: string;
  thinking: Thinking;
}

export const EMPTY_FORM: FormState = {
  format: "music_video",
  artist: "",
  standIns: "",
  touchstones: "",
  city: "",
  budget: "indie",
  directorFilms: "",
  imported: [],
  importedFrom: "",
  thinking: "deep",
};

/** The server's limits (src/lib/agent/brief.ts), checked here so nothing is dropped or rejected silently. */
export const LIMITS = { touchstones: 5, standIns: STAND_IN_LIMIT, directorFilms: 8, name: 80 } as const;

/** One title per line (or separated by semicolons); commas stay, since titles like "Paris, Texas" have them. */
export function splitTitles(text: string): string[] {
  return text
    .split(/[\n;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** A link the importer reads: a TMDB list, IMDb title links or bare IMDb IDs. Anything else typed is a film title. */
export function looksLikeImport(text: string): boolean {
  return /themoviedb\.org\/list\/|imdb\.com\/title\/tt\d|^tt\d{7,10}\b/i.test(text.trim());
}

const sameTitle = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

/** One typed film added to your taste, unless it is already there. */
export function addFilm(form: FormState, title: string): FormState {
  const films = splitTitles(form.directorFilms);
  if (!title.trim() || films.some((film) => sameTitle(film, title))) return form;
  return { ...form, directorFilms: [...films, title.trim()].join("\n") };
}

export function removeFilm(form: FormState, title: string): FormState {
  return {
    ...form,
    directorFilms: splitTitles(form.directorFilms)
      .filter((film) => film !== title)
      .join("\n"),
  };
}

/** The brief in one line, as the poster and the run's summary read it: "Music video for Frank Ocean, New York". */
export function briefLine(form: FormState): string {
  const who = form.artist.trim();
  const after = splitTitles(form.touchstones);
  const where = form.city.trim() || "your city";
  return form.format === "music_video"
    ? `Music video${who ? ` for ${who}` : ""}, ${where}`
    : `Short film${after.length > 0 ? ` after ${after.join(" and ")}` : ""}, ${where}`;
}

/** An example brief as a chip: "Frank Ocean, New York" or "after In the Mood for Love, Mumbai". */
export function exampleChip(brief: BriefInput): string {
  const who = brief.artist ?? (brief.touchstones?.length ? `after ${brief.touchstones[0]}` : "");
  return [who, brief.city].filter(Boolean).join(", ");
}

export type FieldName = "artist" | "touchstones" | "standIns" | "city" | "directorFilms";
export interface FormProblem {
  field: FieldName;
  message: string;
}

/** Client-side check of a brief, in the order a director reads the form. */
export function validateForm(form: FormState): FormProblem | null {
  const isVideo = form.format === "music_video";
  const touchstones = splitTitles(form.touchstones);
  const standIns = splitTitles(form.standIns);
  const films = splitTitles(form.directorFilms);
  const tooLong = (titles: string[]) => titles.find((t) => t.length > LIMITS.name);
  // A music video starts from its artist; a short film from the films it's after.
  if (isVideo && form.artist.trim().length > LIMITS.name) {
    return { field: "artist", message: `Keep the artist name under ${LIMITS.name} characters.` };
  }
  if (isVideo && !form.artist.trim() && touchstones.length === 0) {
    return { field: "artist", message: "Add the artist, or some reference films." };
  }
  if (!isVideo && touchstones.length === 0) return { field: "touchstones", message: "Add at least one film your short is after." };
  if (touchstones.length > LIMITS.touchstones) {
    return { field: "touchstones", message: `Use up to ${LIMITS.touchstones} films; you have ${touchstones.length}.` };
  }
  if (tooLong(touchstones)) return { field: "touchstones", message: `Each title must be under ${LIMITS.name} characters.` };
  if (!form.city.trim()) return { field: "city", message: "Add the shoot city." };
  if (form.city.trim().length > LIMITS.name) return { field: "city", message: `Keep the city under ${LIMITS.name} characters.` };
  if (!isVideo && form.artist.trim().length > LIMITS.name) {
    return { field: "artist", message: `Keep the artist name under ${LIMITS.name} characters.` };
  }
  if (isVideo && standIns.length > LIMITS.standIns) {
    return { field: "standIns", message: `Use up to ${LIMITS.standIns} stand-in artists; you have ${standIns.length}.` };
  }
  if (isVideo && tooLong(standIns)) return { field: "standIns", message: `Each name must be under ${LIMITS.name} characters.` };
  if (films.length > LIMITS.directorFilms) {
    return { field: "directorFilms", message: `Use up to ${LIMITS.directorFilms} of your films; you have ${films.length}.` };
  }
  if (tooLong(films)) return { field: "directorFilms", message: `Each title must be under ${LIMITS.name} characters.` };
  return null;
}

export function toBrief(form: FormState, picks: Record<string, string> = {}, nudges: Nudge[] = []): BriefInput {
  return {
    format: form.format,
    artist: form.artist.trim() || undefined,
    // Stand-ins only speak for a music video's artist.
    stand_ins: form.format === "music_video" && form.artist.trim() ? splitTitles(form.standIns) : [],
    touchstones: splitTitles(form.touchstones),
    city: form.city.trim(),
    budget: form.budget,
    director_films: splitTitles(form.directorFilms),
    director_imdb_ids: form.imported.map((film) => film.imdb),
    picks,
    nudges,
    thinking: form.thinking,
  };
}

/** The form a brief fills in: how an example shows up in the form before it runs. */
export function formFromBrief(brief: BriefInput): FormState {
  return {
    format: brief.format ?? EMPTY_FORM.format,
    artist: brief.artist ?? "",
    standIns: (brief.stand_ins ?? []).join("\n"),
    touchstones: (brief.touchstones ?? []).join("\n"),
    city: brief.city,
    budget: brief.budget ?? EMPTY_FORM.budget,
    directorFilms: (brief.director_films ?? []).join("\n"),
    // A brief keeps only IMDb IDs, so they stand in for the titles here.
    imported: (brief.director_imdb_ids ?? []).map((imdb) => ({ imdb, title: imdb })),
    importedFrom: brief.director_imdb_ids?.length ? "an earlier import" : "",
    thinking: brief.thinking ?? EMPTY_FORM.thinking,
  };
}
