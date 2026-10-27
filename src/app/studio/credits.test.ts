import { describe, expect, it } from "vitest";
import type { Credit, StepEvent, StepId, StepStatus } from "@/lib/agent/types";
import { bill, type Billed } from "./credits";

const step = (id: StepId, status: StepStatus, credit?: Credit): StepEvent => ({ type: "step", id, status, label: id, credit });
const run = (...events: StepEvent[]) => events.reduce<Billed[]>(bill, []);

describe("bill", () => {
  it("keeps one credit per kind, in the order they first came", () => {
    const credits = run(
      step("resolve", "running"),
      step("resolve", "done", { kind: "subject", names: ["Prateek Kuhad"] }),
      step("audience", "warning", { kind: "audience", names: ["intimate", "melancholic"] }),
      step("plan", "done", { kind: "base", names: ["Bandra West"] }),
    );
    expect(credits.map((c) => [c.kind, c.step])).toEqual([
      ["subject", "resolve"],
      ["audience", "audience"],
      ["base", "plan"],
    ]);
  });

  it("updates a credit in its place when a re-plan sends it again, and keeps it while the step runs again", () => {
    const first = run(
      step("plan", "done", { kind: "base", names: ["Bandra West"] }),
      step("tags", "done", { kind: "style", names: ["vintage"] }),
      step("references", "done", { kind: "films", names: ["Sita Ramam"] }),
    );
    const again = [
      step("replan", "done", { kind: "base", names: ["Churchgate"] }),
      step("tags", "running"),
      step("references", "running"),
    ].reduce(bill, first);
    expect(again.map((c) => c.names)).toEqual([["Churchgate"], ["vintage"], ["Sita Ramam"]]);
    const settled = [step("tags", "done", { kind: "style", names: ["streetwear"] })].reduce(bill, again);
    expect(settled.map((c) => [c.kind, c.names[0], c.step])).toEqual([
      ["base", "Churchgate", "replan"],
      ["style", "streetwear", "tags"],
      ["films", "Sita Ramam", "references"],
    ]);
  });

  it("takes back a credit when its step finishes again with nothing, but not one another step sent", () => {
    const before = run(
      step("plan", "done", { kind: "base", names: ["Bandra West"] }),
      step("wardrobe", "done", { kind: "brands", names: ["Nicobar"] }),
    );
    // A template re-plan earns no credit, and the base it would have replaced came from the plan step.
    expect([step("replan", "warning")].reduce(bill, before)).toEqual(before);
    expect([step("replan", "skipped")].reduce(bill, before)).toEqual(before);
    // Wardrobe ran again and found nothing: its old brands aren't in the treatment any more.
    expect([step("wardrobe", "running"), step("wardrobe", "warning")].reduce(bill, before).map((c) => c.kind)).toEqual(["base"]);
  });
});
