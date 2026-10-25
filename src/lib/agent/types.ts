import type { LlmAttempt, LlmMode, ProducedBy } from "../llm";
import type { CompactEntity, CompactTag, Provenance, QlooMode } from "../qloo";
import type { Brief } from "./brief";

export type StepId =
  | "resolve"
  | "audience"
  | "overlap"
  | "plan"
  | "tags"
  | "references"
  | "wardrobe"
  | "locations"
  | "replan"
  | "write";

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

export type Role = "artist" | "touchstone" | "director";

export interface Ambiguity {
  /** pickKey(type, input): the key the client sends back in brief.picks. */
  key: string;
  input: string;
  role: Role;
  status: "ambiguous" | "not_found";
  candidates: CompactEntity[];
}

export type AgentEvent =
  | { type: "start"; runId: string; qlooMode: QlooMode; llmMode: LlmMode; cached: boolean }
  | StepEvent
  | { type: "needs_input"; message: string; items: Ambiguity[] }
  | { type: "treatment"; treatment: Treatment; cached: boolean }
  | { type: "error"; message: string }
  | { type: "done" };

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
  wardrobe: Pick<"look">[];
  locations: Pick<"scene">[];
  palette: { name: string; hex: string }[];
  lighting: string[];
  shots: string[];
  /** Qloo results the writer did not cite, still shown as evidence. */
  extras: { references: CompactEntity[]; brands: CompactEntity[]; locations: CompactEntity[] };
  audience: { taste_tags: CompactTag[]; overlap: CompactTag[]; leans: string[] };
  subjects: CompactEntity[];
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
