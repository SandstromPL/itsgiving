import type { LlmAttempt, LlmMode, ProducedBy } from "../llm";
import type { CompactEntity, CompactTag, Provenance, QlooMode } from "../qloo";
import type { HeatArea, HeatGrid } from "../tools/heatmap";
import type { RankedTag } from "../tools/taste";
import type { Brief } from "./brief";

export type StepId =
  "resolve" | "audience" | "overlap" | "heatmap" | "plan" | "tags" | "references" | "wardrobe" | "locations" | "replan" | "write";

export type StepStatus = "running" | "done" | "warning" | "skipped" | "error";

export type LlmStep = "plan" | "replan" | "write";

export interface LlmTrace {
  step: LlmStep;
  producedBy: ProducedBy;
  /** Live mode fell back to the mock because every real provider failed or the daily cap was hit. */
  degraded: boolean;
  attempts: LlmAttempt[];
  calls: number;
}

export interface StepEvent {
  type: "step";
  id: StepId;
  status: StepStatus;
  label: string;
  summary?: string;
  ms?: number;
  qloo?: Provenance[];
  llm?: LlmTrace;
}

export type Role = "artist" | "touchstone" | "director" | "stand_in";

export interface Ambiguity {
  /** pickKey(type, input): the key the client sends back in brief.picks. */
  key: string;
  input: string;
  role: Role;
  status: "ambiguous" | "not_found";
  /** False when none of the candidates has the name as typed: they are Qloo's nearest names, and may all be wrong. */
  exact: boolean;
  candidates: CompactEntity[];
}

/** A brief field a failed run points at, so the studio can show the message there. */
export type BriefField = "stand_ins";

export type AgentEvent =
  | { type: "start"; runId: string; qlooMode: QlooMode; llmMode: LlmMode; cached: boolean }
  | StepEvent
  | { type: "needs_input"; message: string; items: Ambiguity[] }
  /** `seal` (seal.ts) lets the studio save it; there's none when accounts aren't set up. */
  | { type: "treatment"; treatment: Treatment; cached: boolean; seal?: string }
  | { type: "error"; message: string; field?: BriefField }
  | { type: "done" };

/** Who a treatment is for and after, by name. The audience can come from someone else: see standIns. */
export interface TreatmentWho {
  /** The artist as the brief names them: Qloo's spelling when Qloo has them, the brief's when it doesn't. */
  artists: string[];
  films: string[];
  /** Artists whose audience stood in for an artist Qloo doesn't have. */
  standIns: string[];
}

/** What Qloo itself said about an item, kept apart from the LLM's interpretation. */
export interface QlooEvidence {
  tool: string;
  /** 1-based rank within the one Qloo call that returned it (affinity is only comparable within a call). */
  rank: number;
  of: number;
  affinity?: number | null;
  popularity?: number;
  tags: string[];
  /** Input entities that drove the pick, from feature.explainability. */
  because: { name: string; score: number }[];
}

export interface Pick<Note extends string> {
  entity: CompactEntity;
  qloo: QlooEvidence;
  /** LLM interpretation. */
  notes: Record<Note, string>;
  /**
   * A reference film's still, without lettering (TMDB's backdrop), for the cover and its card: Qloo's own image of a
   * film is its poster. Missing on treatments built before 2026-10-26, in mock mode, and where TMDB has none.
   */
  still?: string;
}

export interface TonePick {
  tag: CompactTag;
  source: "audience" | "overlap";
  note: string;
}

export interface Beat {
  title: string;
  description: string;
  reference: { id: string; name: string } | null;
}

/** An area from Qloo's heatmap, with the ref (A1, A2...) the planner chose it by. */
export interface BaseArea extends HeatArea {
  ref: string;
}

/** Where the shoot is based: the areas where the audience over-indexes, and the one the planner picked. */
export interface ShootBase {
  /** Ref of the area the planner chose. */
  chosen: string;
  /** False when too few places matched inside it, so locations were scouted across the city. */
  held: boolean;
  areas: BaseArea[];
  /** The heatmap the board draws. */
  map?: HeatGrid;
}

export interface Treatment {
  id: string;
  createdAt: string;
  brief: Brief;
  title: string;
  logline: string;
  concept: string;
  /** The planner's creative direction. */
  direction: string;
  tone: TonePick[];
  beats: Beat[];
  references: Pick<"why" | "borrow">[];
  /**
   * The entity ID of the reference the writer chose for the cover: its still is the cover art (coverReference). Missing
   * on treatments built before 2026-10-27 and when the writer named none of its references.
   */
  cover?: string;
  wardrobe: Pick<"look">[];
  locations: Pick<"scene">[];
  /** Missing on treatments built before the heatmap step, and when Qloo had no heatmap for the city. */
  base?: ShootBase;
  palette: { name: string; hex: string }[];
  lighting: string[];
  shots: string[];
  /** Qloo results the writer did not cite, still shown as evidence. */
  extras: { references: CompactEntity[]; brands: CompactEntity[]; locations: CompactEntity[] };
  audience: {
    taste_tags: CompactTag[];
    overlap: CompactTag[];
    leans: string[];
    /**
     * The film subgenres the audience over-indexes on, in Qloo's order, each with its place in Qloo's list. Tags that say
     * who people are are left out. The cover's era suggestion reads them (studio/eras.ts). Missing on treatments built
     * before 2026-10-27, and when the call failed.
     */
    subgenres?: RankedTag[];
  };
  /** The entities whose audience Qloo read. */
  subjects: CompactEntity[];
  /** Missing on treatments built before stand-ins (2026-10-26); treatmentWho() falls back to the subjects. */
  who?: TreatmentWho;
  director: CompactEntity[];
  /** Relaxations, skipped items and other caveats, in plain words. */
  notes: string[];
  llm: LlmTrace[];
  writtenBy: ProducedBy;
  qloo: { mode: QlooMode; calls: number; steps: Partial<Record<StepId, Provenance[]>> };
  mock: { qloo: boolean; llm: boolean };
  /** False when a Qloo call failed along the way: shown as is, but never cached. */
  complete: boolean;
  priceLevelMax?: number;
}
