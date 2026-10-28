import { describe, expect, it } from "vitest";
import type { CompactEntity } from "../qloo";
import type { ToolResult } from "../tools/types";
import { ladder, relax, report } from "./pipeline-relax";
import type { Run } from "./pipeline-run";
import type { AgentEvent } from "./types";

const place = (name: string): CompactEntity => ({ id: `id-${name}`, name, tags: [] });

/** A run whose Qloo answers each rung in turn, with places or with a failure, and remembers what each rung asked. */
function answering(answers: (CompactEntity[] | Error)[]) {
  const asked: unknown[] = [];
  const tool = async (_step: string, name: string, input: unknown): Promise<ToolResult> => {
    asked.push(input);
    const answer = answers.shift() ?? [];
    const base = { tool: name, warnings: [], provenance: [], mode: "mock" as const };
    return answer instanceof Error
      ? { ...base, status: "error", summary: "failed", data: null, error: { kind: "upstream", message: answer.message, retryable: true } }
      : { ...base, status: answer.length > 0 ? "ok" : "empty", summary: `${answer.length} found`, data: { locations: answer } };
  };
  return { run: { tool } as unknown as Run, asked };
}

describe("ladder", () => {
  it("keeps each rung's changes for the next, and skips rungs that wouldn't change anything", () => {
    expect(
      ladder({ near: "Bandra West", kinds: ["cafe"], photos: true }, [
        ["widened to the city", { near: undefined }, true],
        ["widened to every kind of venue", { kinds: ["cafe", "bar"] }, false],
        ["allowed places without photos", { photos: false }, true],
      ]),
    ).toEqual([
      ["", { near: "Bandra West", kinds: ["cafe"], photos: true }],
      ["widened to the city", { near: undefined, kinds: ["cafe"], photos: true }],
      ["allowed places without photos", { near: undefined, kinds: ["cafe"], photos: false }],
    ]);
  });
});

describe("relax", () => {
  const rungs = ladder({ near: "Bandra West", photos: true }, [
    ["widened to the city", { near: undefined }, true],
    ["allowed places without photos", { photos: false }, true],
  ]);

  it("stops at the first rung that finds enough, naming the rungs it took and how few the first one found", async () => {
    const { run, asked } = answering([[place("a")], [place("b"), place("c"), place("d")]]);
    expect(await relax(run, "locations", "scout_locations", "locations", rungs, 3)).toEqual({
      items: [place("b"), place("c"), place("d")],
      relaxations: ["widened to the city"],
      firstCount: 1,
    });
    expect(asked).toEqual([rungs[0][1], rungs[1][1]]);
  });

  it("keeps a short first find when every wider rung comes back empty", async () => {
    const { run } = answering([[place("a")], [], []]);
    expect(await relax(run, "locations", "scout_locations", "locations", rungs, 3)).toEqual({ items: [place("a")], relaxations: [] });
  });

  it("treats a failed rung like an empty one, and keeps the last failure when no rung found anything", async () => {
    const { run, asked } = answering([new Error("Qloo timed out"), [], new Error("Qloo returned 503")]);
    expect(await relax(run, "locations", "scout_locations", "locations", rungs)).toEqual({
      items: [],
      relaxations: ["widened to the city", "allowed places without photos"],
      error: "Qloo returned 503",
    });
    expect(asked).toHaveLength(3);
  });
});

describe("report", () => {
  const reporting = () => {
    const events: AgentEvent[] = [];
    const run = { notes: [] as string[], emit: (event: AgentEvent) => void events.push(event), trail: {} } as unknown as Run;
    return { run, events };
  };
  const describePlaces = (items: CompactEntity[]) => items.map((p) => p.name).join(", ");

  it("credits a relaxed find, and notes what was given up for it", () => {
    const { run, events } = reporting();
    report(
      run,
      "locations",
      "places",
      "Scout locations",
      "Locations",
      { items: [place("Bar Orai")], relaxations: ["widened to the city"], firstCount: 1 },
      describePlaces,
    );
    expect(run.notes).toEqual(["Locations: only 1 matched at first, so itsgiving widened to the city."]);
    expect(events).toEqual([
      {
        type: "step",
        id: "locations",
        status: "warning",
        label: "Scout locations",
        summary: "Bar Orai (relaxed: widened to the city)",
        credit: { kind: "places", names: ["Bar Orai"] },
      },
    ]);
  });

  it("ends a search that failed outright as the step's error", () => {
    const { run, events } = reporting();
    report(
      run,
      "locations",
      "places",
      "Scout locations",
      "Locations",
      { items: [], relaxations: ["widened to the city"], error: "Qloo returned 503" },
      describePlaces,
    );
    expect(run.notes).toEqual(["Scout locations: Qloo returned 503"]);
    expect(events).toEqual([{ type: "step", id: "locations", status: "error", label: "Scout locations", summary: "Qloo returned 503" }]);
  });
});
