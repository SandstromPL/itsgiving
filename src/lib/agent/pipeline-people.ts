import { BUDGETS, STEP_LABELS } from "./options";
import { ladder, relax, report, type Relaxed } from "./pipeline-relax";
import type { Cast } from "./pipeline-resolve";
import { names, type Run } from "./pipeline-run";

// The faces this audience knows: the actors Qloo says it over-indexes on, as casting references. They need only the
// subjects, so the search starts as soon as the names are resolved and runs beside the audience read and the plan; the
// writer is the first to wait for it, and a re-plan doesn't ask again.

/** Fewer actors than this within the budget's reach, and the ceiling is lifted. */
const MIN_FACES = 4;

export interface People {
  casting: Relaxed;
}

export async function findPeople(run: Run, cast: Cast): Promise<People> {
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
  return { casting };
}
