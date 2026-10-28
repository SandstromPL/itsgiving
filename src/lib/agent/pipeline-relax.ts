import type { CompactEntity } from "../qloo";
import { toCredit, type Run } from "./pipeline-run";
import type { CreditKind, StepId, StepStatus } from "./types";

// A search that finds too little is tried again, lighter, one rung of its ladder at a time; the step's summary and the
// treatment's notes say what was given up to find something.

export interface Relaxed {
  items: CompactEntity[];
  relaxations: string[];
  /** How many the first search found when that was too few to keep (it is then relaxed). */
  firstCount?: number;
  error?: string;
}

/** Run the ladder until a rung finds enough: `firstMin` for the first rung (a shoot base needs a few places), one after. */
export async function relax(
  run: Run,
  step: StepId,
  toolName: string,
  key: string,
  ladder: [string, Record<string, unknown>][],
  firstMin = 1,
): Promise<Relaxed> {
  const relaxations: string[] = [];
  let lastError: string | undefined;
  let firstCount: number | undefined;
  // A first rung that found some but too few: still better than nothing if every wider rung fails.
  let short: Relaxed | undefined;
  for (let i = 0; i < ladder.length; i++) {
    const result = await run.tool<Record<string, CompactEntity[]>>(step, toolName, ladder[i][1]);
    const items = result.data?.[key] ?? [];
    if (result.status !== "error" && items.length >= (i === 0 ? firstMin : 1)) return { items, relaxations, firstCount };
    if (result.status !== "error" && items.length > 0) {
      firstCount = items.length;
      short = { items, relaxations: [] };
    }
    // A failed call is treated like an empty one: the next rung is usually lighter (no tag signals), which is
    // exactly what helps when Qloo is slow on a heavy query.
    if (result.status === "error") lastError = result.error?.message ?? result.summary;
    if (i + 1 < ladder.length) relaxations.push(ladder[i + 1][0]);
  }
  if (short) return short;
  return lastError ? { items: [], relaxations, error: lastError } : { items: [], relaxations };
}

/** Each rung keeps the previous rung's changes; rungs that change nothing are skipped. */
export function ladder(base: Record<string, unknown>, rungs: [string, Record<string, unknown>, boolean][]) {
  const steps: [string, Record<string, unknown>][] = [["", base]];
  for (const [label, patch, applies] of rungs) {
    if (applies) steps.push([label, { ...steps[steps.length - 1][1], ...patch }]);
  }
  return steps;
}

/** Ends a relaxed step with what it found, and notes what had to give for it. */
export function report(
  run: Run,
  step: StepId,
  kind: CreditKind,
  label: string,
  what: string,
  relaxed: Relaxed,
  describe: (items: CompactEntity[]) => string,
  billed = true,
) {
  const { notes, emit, trail } = run;
  if (relaxed.error) {
    notes.push(`${label}: ${relaxed.error}`);
    emit({ type: "step", id: step, status: "error", label, summary: relaxed.error, qloo: trail[step] });
    return;
  }
  if (relaxed.relaxations.length > 0) {
    const first = relaxed.firstCount ? `only ${relaxed.firstCount} matched at first` : "nothing matched at first";
    notes.push(`${what}: ${first}, so itsgiving ${relaxed.relaxations.join(", then ")}.`);
  }
  const status: StepStatus = relaxed.items.length === 0 || relaxed.relaxations.length > 0 ? "warning" : "done";
  const summary =
    relaxed.items.length === 0
      ? `No ${what.toLowerCase()} matched, even after relaxing.`
      : `${describe(relaxed.items)}${relaxed.relaxations.length > 0 ? ` (relaxed: ${relaxed.relaxations.join(", ")})` : ""}`;
  // Relaxed finds are credited too: they are what the treatment uses.
  emit({ type: "step", id: step, status, label, summary, qloo: trail[step], ...(billed ? { credit: toCredit(kind, relaxed.items) } : {}) });
}
