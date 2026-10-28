import type { CompactEntity } from "../qloo";
import { pickKey } from "./brief";
import { NONE_PICK, STAND_IN_LIMIT, STEP_LABELS, joinNames, withYear } from "./options";
import { names, toCredit, uniqueBy, type PipelineOutcome, type Run } from "./pipeline-run";
import type { Who } from "./plan";
import type { Ambiguity, Role } from "./types";

// The run's first step: find the brief's names in Qloo. The run stops here when a name needs the director's call, or
// when nothing is left to read an audience from.

type Resolution =
  | { input: string; status: "resolved"; match: CompactEntity; among?: number; note?: string }
  | { input: string; status: "ambiguous"; candidates: CompactEntity[]; exact: boolean }
  | { input: string; status: "not_found" };

interface NameSpec {
  /** Exactly what the director typed; pick keys and questions use it. */
  input: string;
  /** The title to search for, without a trailing "(2011)". */
  name: string;
  year?: number;
  type: "artist" | "movie";
  role: Role;
}

/** "Rockstar (2011)" -> name "Rockstar", year 2011, so same-name titles resolve without a question. */
export function parseTitle(input: string): { name: string; year?: number } {
  const match = /^(.*\S)\s*\((\d{4})\)$/.exec(input.trim());
  if (!match) return { name: input.trim() };
  const year = Number(match[2]);
  return year >= 1870 && year <= 2100 ? { name: match[1], year } : { name: input.trim() };
}

/** Who the brief names, as Qloo has them: what every later step reads from and writes for. */
export interface Cast {
  kind: "resolved";
  /** The entities whose audience Qloo reads. */
  subjects: CompactEntity[];
  touchstones: CompactEntity[];
  /** Artists whose audience is read for a music video's artist that Qloo doesn't have. */
  standIns: CompactEntity[];
  /** The director's own films: the typed ones, then the imported ones. */
  director: CompactEntity[];
  /** Who it's for and after, by the names the prompts use. */
  who: Who;
  subjectIds: string[];
  directorIds: string[];
  /** Entity ID -> name, to show which input drove a pick. */
  entityNames: Map<string, string>;
  /** The shoot city as a Qloo locality, when Qloo placed it. */
  cityId?: string;
}

/** How a run ends early: with a question for the director, or a failure. */
type Stop = Exclude<PipelineOutcome, { kind: "treatment" }>;

export async function resolveCast(run: Run): Promise<Cast | Stop> {
  const { brief, notes, tool, begin } = run;
  const isVideo = brief.format === "music_video";
  const film = (input: string, role: Role): NameSpec => ({ input, ...parseTitle(input), type: "movie", role });
  const musician = (input: string, role: Role): NameSpec => ({ input, name: input, type: "artist", role });
  const artistSpec = brief.artist ? musician(brief.artist, "artist") : undefined;
  const touchstoneSpecs = brief.touchstones.map((input) => film(input, "touchstone"));
  // Stand-ins only speak for a music video's artist. They're looked up with the rest but used only if Qloo lacks the artist.
  const standInSpecs = isVideo && artistSpec ? (brief.stand_ins ?? []).map((input) => musician(input, "stand_in")) : [];
  const subjectSpecs: NameSpec[] = [...(artistSpec ? [artistSpec] : []), ...touchstoneSpecs, ...standInSpecs];
  const directorSpecs: NameSpec[] = brief.director_films.map((input) => film(input, "director"));
  const endResolve = begin("resolve", STEP_LABELS.resolve);
  const asItems = (specs: NameSpec[]) => ({ items: specs.map(({ name, year, type }) => ({ name, type, ...(year ? { year } : {}) })) });
  const imported = brief.director_imdb_ids ?? [];
  const [subjectResult, directorResult, cityResult, importedResult] = await Promise.all([
    tool<{ items: Resolution[] }>("resolve", "resolve_entities", asItems(subjectSpecs)),
    directorSpecs.length > 0 ? tool<{ items: Resolution[] }>("resolve", "resolve_entities", asItems(directorSpecs)) : null,
    // The city as a Qloo locality is more exact than its name: live "New York" by name is the state.
    tool<{ items: Resolution[] }>("resolve", "resolve_entities", { items: [{ name: brief.city, type: "locality" }] }),
    // Imported taste is looked up by IMDb ID: exact, one request for up to 25 films, and nothing to ask about.
    imported.length > 0 ? tool<{ entities: CompactEntity[] }>("resolve", "import_external_ids", { imdb_ids: imported }) : null,
  ]);
  if (subjectResult.status === "error" || !subjectResult.data) {
    endResolve("error", subjectResult.summary);
    return { kind: "failed", message: `Couldn't look up the brief in Qloo: ${subjectResult.error?.message ?? subjectResult.summary}` };
  }
  if (directorResult?.status === "error")
    notes.push(`Your taste films couldn't be looked up (${directorResult.summary}), so they were left out.`);
  const importedFilms = importedResult?.data?.entities ?? [];
  if (importedResult?.status === "error") {
    notes.push(`Your imported films couldn't be looked up (${importedResult.summary}), so they were left out.`);
  } else if (importedResult && importedFilms.length < imported.length) {
    const left = imported.length - importedFilms.length;
    notes.push(
      `${left} of your imported films ${left === 1 ? "isn't" : "aren't"} in Qloo's catalog, so ${left === 1 ? "it was" : "they were"} left out.`,
    );
  }

  const ambiguities: Ambiguity[] = [];
  const missing: NameSpec[] = [];
  const settle = (spec: NameSpec, resolution: Resolution | undefined): CompactEntity | undefined => {
    const key = pickKey(spec.type, spec.input);
    if (resolution?.status === "resolved") {
      if (resolution.among) {
        const m = resolution.match;
        notes.push(
          `"${spec.input}" matched ${resolution.among} titles in Qloo; itsgiving used the far better-known ${withYear(m.name, m.year)}.`,
        );
      }
      if (resolution.note) notes.push(resolution.note);
      return resolution.match;
    }
    if (resolution?.status === "ambiguous") {
      // A pick only counts if it is one of the candidates Qloo returned, or none of them.
      const chosen = resolution.candidates.find((c) => c.id === brief.picks[key]);
      if (chosen) return chosen;
      if (brief.picks[key] !== NONE_PICK) {
        ambiguities.push({
          key,
          input: spec.input,
          role: spec.role,
          status: "ambiguous",
          exact: resolution.exact,
          candidates: resolution.candidates,
        });
        return undefined;
      }
    }
    missing.push(spec);
    return undefined;
  };
  const settleAll = (specs: NameSpec[]) =>
    specs.map((spec) => settle(spec, subjectResult.data?.items[subjectSpecs.indexOf(spec)])).filter((e): e is CompactEntity => Boolean(e));

  // The artist first: whether Qloo has them decides whether the stand-ins are needed.
  let artist: CompactEntity | undefined;
  let artistMissing = false;
  if (artistSpec) {
    const resolution = subjectResult.data.items[0];
    const answered = brief.picks[pickKey(artistSpec.type, artistSpec.input)] !== undefined;
    const nearMissesOnly = resolution?.status === "not_found" || (resolution?.status === "ambiguous" && !resolution.exact && !answered);
    if (standInSpecs.length > 0 && nearMissesOnly) {
      // The director already named who carries the audience, so Qloo's nearest names aren't worth a question.
      artistMissing = true;
      if (resolution?.status === "ambiguous") {
        notes.push(
          `Qloo's nearest names to "${artistSpec.input}" were ${joinNames(resolution.candidates.slice(0, 3).map((c) => c.name))}.`,
        );
      }
    } else {
      artist = settle(artistSpec, resolution);
      artistMissing = missing.includes(artistSpec);
    }
  }
  const touchstones = settleAll(touchstoneSpecs);
  const standIns = artistMissing ? settleAll(standInSpecs) : [];
  if (artist && standInSpecs.length > 0) notes.push(`Qloo has ${artist.name}, so the stand-in artists weren't needed.`);
  const subjects = uniqueBy([...(artist ? [artist] : []), ...touchstones, ...standIns], (e) => e.id);
  const director = uniqueBy(
    [
      ...directorSpecs
        .map((spec, i) => (directorResult?.data ? settle(spec, directorResult.data.items[i]) : undefined))
        .filter((e): e is CompactEntity => Boolean(e)),
      ...importedFilms,
    ],
    (e) => e.id,
  );

  if (ambiguities.length > 0) {
    // The same title can sit in two lists (touchstones and your taste); one question answers both.
    const questions = uniqueBy(ambiguities, (a) => a.key);
    endResolve("warning", `Need your call on ${questions.map((a) => `"${a.input}"`).join(", ")}.`);
    const message = questions.every((q) => q.exact)
      ? "Some names match more than one title in Qloo, so itsgiving won't guess."
      : questions.every((q) => !q.exact)
        ? "Qloo has nothing under these exact names, so itsgiving won't guess. Pick the right one, or none of them."
        : "Some names need your call before itsgiving goes on.";
    return { kind: "needs_input", message, items: questions };
  }
  // A music video keeps its artist's name whatever Qloo has; only the audience comes from someone else.
  const artistGone = isVideo && artistMissing;
  if (subjects.length === 0) {
    endResolve("error", `Not found: ${missing.map((m) => m.input).join(", ")}.`);
    if (artistGone && brief.artist) {
      const triedStandIns = missing.filter((m) => m.role === "stand_in").map((m) => m.input);
      return {
        kind: "failed",
        field: "stand_ins",
        message:
          triedStandIns.length > 0
            ? `Qloo doesn't have ${brief.artist}, or ${joinNames(triedStandIns)}. Try other artists with a similar audience.`
            : `Qloo doesn't have ${brief.artist}. Name up to ${STAND_IN_LIMIT} artists with a similar audience: the treatment keeps ${brief.artist}'s name and reads their fans instead.`,
      };
    }
    return {
      kind: "failed",
      message: `Qloo couldn't find ${missing.map((m) => `"${m.input}"`).join(", ")}. Check the spelling or try another artist or film.`,
    };
  }
  if (artistGone && brief.artist) {
    notes.push(
      standIns.length > 0
        ? `Qloo doesn't have ${brief.artist}, so the audience was read through ${joinNames(names(standIns))}; the treatment keeps ${brief.artist}'s name.`
        : `Qloo doesn't have ${brief.artist}, so the audience was read from the reference films alone.`,
    );
  }
  const leftOut = missing.filter((m) => !(artistGone && m === artistSpec)).map((m) => m.input);
  if (leftOut.length > 0) notes.push(`Not in Qloo's catalog, so left out: ${leftOut.join(", ")}.`);
  const resolvedLine =
    artistGone && brief.artist
      ? [
          `${brief.artist} (not in Qloo)`,
          ...(standIns.length > 0 ? [`read through ${joinNames(names(standIns))}`] : []),
          ...names(touchstones),
        ]
      : names(subjects);
  endResolve(
    missing.length > 0 || artistGone ? "warning" : "done",
    `${resolvedLine.join(", ")}${director.length > 0 ? `; your taste: ${director.length} film${director.length === 1 ? "" : "s"}` : ""}.`,
    {
      credit: artistGone && brief.artist ? toCredit("subject", [...standIns, ...touchstones], brief.artist) : toCredit("subject", subjects),
    },
  );

  const subjectIds = subjects.map((e) => e.id);
  const directorIds = director.map((e) => e.id);
  const entityNames = new Map([...subjects, ...director].map((e) => [e.id, e.name]));
  const city = cityResult.data?.items[0];
  const cityId = city?.status === "resolved" ? city.match.id : undefined;
  if (city?.status === "resolved" && city.note) notes.push(city.note);

  const who = {
    // A music video is for its artist by name, in Qloo or not. A short film's artist only says whose fans it's for,
    // so one Qloo lacks drops out.
    artistNames: isVideo ? (brief.artist ? [artist?.name ?? brief.artist] : []) : artist ? [artist.name] : [],
    touchstoneNames: names(touchstones),
    directorNames: names(director),
    standInNames: names(standIns),
    artistMissing: artistGone,
  };
  return { kind: "resolved", subjects, touchstones, standIns, director, who, subjectIds, directorIds, entityNames, cityId };
}
