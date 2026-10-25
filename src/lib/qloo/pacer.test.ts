import { describe, expect, it } from "vitest";
import { Pacer } from "./pacer";

describe("Pacer", () => {
  it("lets a burst through up to the limit, then books the rest a window later", () => {
    let now = 0;
    const pacer = new Pacer(3, 1000, () => now);
    expect(Array.from({ length: 5 }, () => pacer.reserve())).toEqual([0, 0, 0, 1000, 1000]);
    now = 400;
    expect(pacer.reserve()).toBe(600);
    expect(pacer.reserve()).toBe(1600);
    now = 5000;
    expect(pacer.reserve()).toBe(0);
  });

  it("never starts more than the limit in any window, however the calls arrive", () => {
    let now = 0;
    const pacer = new Pacer(8, 1000, () => now);
    const starts: number[] = [];
    for (let i = 0; i < 200; i++) {
      now += [0, 0, 0, 5, 40, 250][i % 6];
      starts.push(now + pacer.reserve());
    }
    for (let i = 8; i < starts.length; i++) expect(starts[i] - starts[i - 8]).toBeGreaterThanOrEqual(1000);
  });
});
