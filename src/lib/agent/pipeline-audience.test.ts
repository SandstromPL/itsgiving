import { describe, expect, it } from "vitest";
import { toneCandidates } from "./pipeline-audience";

const tag = (value: string, name: string) => ({ id: `urn:tag:keyword:qloo:${value}`, name });

describe("toneCandidates", () => {
  it("offers up to six traits shared with the director's films first, then the audience's own, each name once", () => {
    const shared = ["a", "b", "c", "d", "e", "f", "g"].map((x) => tag(x, `Shared ${x}`));
    const own = [tag("dup", "shared  A"), tag("moody", "Moody"), { id: "urn:entity:movie:x", name: "Not a tag" }];
    expect(toneCandidates(shared, own).map((c) => [c.ref, c.tag.name, c.source])).toEqual([
      ["T1", "Shared a", "overlap"],
      ["T2", "Shared b", "overlap"],
      ["T3", "Shared c", "overlap"],
      ["T4", "Shared d", "overlap"],
      ["T5", "Shared e", "overlap"],
      ["T6", "Shared f", "overlap"],
      ["T7", "Moody", "audience"],
    ]);
  });

  it("offers sixteen at most", () => {
    const many = Array.from({ length: 30 }, (_, i) => tag(`t${i}`, `Tag ${i}`));
    expect(toneCandidates([], many).map((c) => c.ref)).toEqual(Array.from({ length: 16 }, (_, i) => `T${i + 1}`));
  });
});
