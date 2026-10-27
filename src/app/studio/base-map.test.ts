import { describe, expect, it } from "vitest";
import { placeLabels } from "./base-map";
import { CREDIT_CORNER } from "./street-map";

// A 480 × 600 frame at a pixel per unit, so the credit takes its corner at full size.
const [W, H] = [480, 600];

describe("placeLabels", () => {
  it("names a ring above it when nothing is in the way", () => {
    expect(placeLabels([{ name: "Bandra West", x: 240, y: 300, r: 40 }], [], W, H)).toEqual([{ side: "above", along: 0 }]);
  });

  it("keeps a name out from under the OpenStreetMap credit", () => {
    // A ring just above the credit's corner, with a pin on its top: under it is the credit, so the name goes beside it.
    const ring = { name: "Chinatown", x: W - CREDIT_CORNER.width + 4, y: H - 60, r: 30 };
    const [placed] = placeLabels([ring], [{ x: ring.x, y: ring.y - ring.r - 13 }], W, H);
    expect(placed).toEqual({ side: "right", along: 0 });
  });

  it("slides a name along its ring before moving it to the side", () => {
    // A pin just right of the ring's top and the credit under it: the name slides to the left along the top.
    const ring = { name: "North Side", x: 400, y: H - 70, r: 30 };
    const [placed] = placeLabels([ring], [{ x: ring.x + 20, y: ring.y - ring.r - 13 }], W, H);
    expect(placed).toEqual({ side: "above", along: -1 });
  });

  it("puts a name where least of it is hidden when nowhere is clear", () => {
    // Pins on every side of the ring, and two over its top: the top right hides least, and comes first of those that do.
    const ring = { name: "Juhu", x: 100, y: 100, r: 20 };
    const pins = [
      { x: 100, y: 67 },
      { x: 75, y: 67 },
      { x: 100, y: 133 },
      { x: 142, y: 100 },
      { x: 58, y: 100 },
    ];
    expect(placeLabels([ring], pins, 200, 200)).toEqual([{ side: "above", along: 1 }]);
  });
});
