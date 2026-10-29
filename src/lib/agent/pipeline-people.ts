import { missingPictures } from "../qloo";
import { BUDGETS, STEP_LABELS } from "./options";
import { ladder, relax, report, type Relaxed } from "./pipeline-relax";
import type { Cast } from "./pipeline-resolve";
import { names, type Run } from "./pipeline-run";
import type { ActorProfile } from "./pipeline-tmdb";

// The faces this audience knows and the music it plays: the actors Qloo says it over-indexes on, as faces for the
// story's characters, with TMDB's photo of each and the parts it says they're known for, and its artists, as a short
// film's music (or, for a music video, what its fans also play). Both need only the subjects, so they start as soon as
// the names are resolved and run beside the audience read and the plan; the writer is the first to wait for them, and a
// re-plan doesn't ask again.

/** Fewer actors than this within the budget's reach, and the ceiling is lifted. */
const MIN_FACES = 4;

/** How many actors the writer sees (as P refs), so how many TMDB is asked about. */
export const WRITER_FACES = 8;

export interface People {
  casting: Relaxed;
  /** What TMDB knows of each actor, by entity ID: their photo and best-known parts, for those TMDB knows. */
  profiles: Map<string, ActorProfile>;
  music: Relaxed;
}

export async function findPeople(run: Run, cast: Cast): Promise<People> {
  const [{ casting, profiles }, music] = await Promise.all([findCasting(run, cast), findMusic(run, cast)]);
  return { casting, profiles, music };
}

async function findMusic(run: Run, cast: Cast): Promise<Relaxed> {
  run.emit({ type: "step", id: "music", status: "running", label: STEP_LABELS.music });
  // The artist itself, and any standing in for one Qloo lacks, are the audience, not its music.
  const exclude = [...cast.subjectIds, ...cast.standIns.map((s) => s.id)].slice(0, 50);
  const music = await relax(run, "music", "music_references", "artists", [
    ["", { signal_entity_ids: cast.subjectIds, exclude_ids: exclude, take: 10 }],
  ]);
  // A music video's song is given: what its fans also play is evidence, not a credit.
  const billed = run.brief.format === "short_film";
  report(run, "music", "music", STEP_LABELS.music, "Music references", music, (items) => names(items).slice(0, 4).join(", "), billed);
  return music;
}

async function findCasting(run: Run, cast: Cast): Promise<Pick<People, "casting" | "profiles">> {
  const ceiling = BUDGETS[run.brief.budget].castCeiling;
  run.emit({ type: "step", id: "casting", status: "running", label: STEP_LABELS.casting });
  const casting = await relax(
    run,
    "casting",
    "casting_references",
    "people",
    ladder(
      // A subject Qloo files as a person (Raftaar) is the artist, not a face to cast.
      { signal_entity_ids: cast.subjectIds, max_popularity: ceiling, exclude_ids: cast.subjectIds.slice(0, 50), take: 10 },
      [
        ["lifted the popularity ceiling", { max_popularity: undefined }, ceiling !== undefined],
        ["let in people Qloo also tags as influencers, athletes or musicians", { actors_only: false }, true],
      ],
    ),
    MIN_FACES,
  );
  report(run, "casting", "cast", STEP_LABELS.casting, "Casting references", casting, (items) => names(items).slice(0, 4).join(", "));
  // After the step: its time is Qloo's. A face whose picture Qloo's image server no longer has is a face Qloo has no
  // picture of, so TMDB's photo stands in for it.
  const faces = casting.items.slice(0, WRITER_FACES);
  const [profiles, gone] = await Promise.all([
    run.tmdb.profiles(faces),
    run.deps.qloo.mode === "mock" ? new Set<string>() : missingPictures(faces, { signal: run.signal }),
  ]);
  const items = casting.items.map((entity) => (gone.has(entity.id) ? { ...entity, image: undefined } : entity));
  return { casting: { ...casting, items }, profiles };
}
