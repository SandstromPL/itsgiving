import { useEffect, useRef, useState } from "react";
import type { Credit, StepEvent, StepId } from "@/lib/agent/types";

/** A credit as the run stage holds it: what it names, and the step that sent it. */
export interface Billed extends Credit {
  step: StepId;
}

/**
 * The run's credits after one step's event: one per kind, in the order they first came. A re-plan runs steps again,
 * and each sends its credit again: the credit keeps its place and takes the new names rather than playing again. A step
 * that finishes again without one takes back what it sent before, so nothing the treatment no longer uses stays billed.
 */
export function bill(credits: Billed[], event: StepEvent): Billed[] {
  if (event.credit) {
    const next: Billed = { ...event.credit, step: event.id };
    const at = credits.findIndex((c) => c.kind === next.kind);
    return at === -1 ? [...credits, next] : credits.map((c, i) => (i === at ? next : c));
  }
  if (event.status === "running") return credits;
  return credits.filter((c) => c.step !== event.id);
}

/**
 * The credits in a run's steps, kept apart from them: the studio replaces a step's row with each event, and a re-plan
 * sends steps back to running without their credits. Only steps whose event changed since the last render are billed.
 */
export function useCredits(steps: StepEvent[]): Billed[] {
  const [seen, setSeen] = useState<{ steps: StepEvent[]; credits: Billed[] }>({ steps: [], credits: [] });
  if (seen.steps === steps) return seen.credits;
  const credits = steps.reduce((all, step) => (seen.steps.includes(step) ? all : bill(all, step)), seen.credits);
  setSeen({ steps, credits });
  return credits;
}

/** How long a credit holds the large slot before the next may take it. */
export const CREDIT_GAP_MS = 1_200;

/**
 * How many of the run's credits are on screen. They arrive as steps finish, but some land together (references,
 * wardrobe and locations report in one moment), so each waits until the one before it has had its time.
 */
export function useShown(count: number): number {
  const [shown, setShown] = useState(0);
  const last = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (shown >= count) return;
    const timer = setTimeout(
      () => {
        last.current = Date.now();
        setShown((n) => n + 1);
      },
      Math.max(0, last.current + CREDIT_GAP_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [shown, count]);
  return Math.min(shown, count);
}
