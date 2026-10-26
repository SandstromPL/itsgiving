import type { BriefInput } from "@/lib/agent/brief";
import type { Budget, Format, Nudge, Thinking } from "@/lib/agent/options";
import type { ImportedFilm } from "@/lib/agent/taste";

// The brief form's state and the conversions between it and a brief. Kept apart from the component so
// a featured example and the form it fills in are guaranteed to make the same brief (and cache key).

export interface FormState {
  format: Format;
  artist: string;
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
  touchstones: "",
  city: "",
  budget: "indie",
  directorFilms: "",
  imported: [],
  importedFrom: "",
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

/** An example brief as a chip: "Frank Ocean, New York" or "after In the Mood for Love, Mumbai". */
export function exampleChip(brief: BriefInput): string {
  const who = brief.artist ?? (brief.touchstones?.length ? `after ${brief.touchstones[0]}` : "");
  return [who, brief.city].filter(Boolean).join(", ");
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

export function toBrief(form: FormState, picks: Record<string, string> = {}, nudges: Nudge[] = []): BriefInput {
  return {
    format: form.format,
    artist: form.artist.trim() || undefined,
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
