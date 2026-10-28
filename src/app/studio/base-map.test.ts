import { describe, expect, it } from "vitest";
import { mapName, placeLabels, placePinName } from "./base-map";
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

describe("placePinName", () => {
  // "Cafe Madina" in its pill is about 85 × 20 at a pixel per unit, 20 from the lit dot's centre.
  const name = "Cafe Madina";
  type Area = { ring: Parameters<typeof placePinName>[2][number]; placed: Parameters<typeof placePinName>[3][number] };
  // An area's name beside a small ring at (x, y): to its right, it covers about x + 14 to x + 90, across y ± 9.
  const areaAt = (x: number, label = "Kurla West", y = 300, side: Area["placed"]["side"] = "right"): Area => ({
    ring: { name: label, x, y, r: 10 },
    placed: { side, along: 0 },
  });
  const place = (pin: { x: number; y: number }, areas: Area[], width = W, height = H) =>
    placePinName(
      pin,
      name,
      areas.map((a) => a.ring),
      areas.map((a) => a.placed),
      [],
      width,
      height,
    );

  it("keeps the dot's roomier side when nothing is in the way, as before", () => {
    expect(place({ x: 100, y: 300 }, [])).toEqual({ side: "right", slide: 0 });
    expect(place({ x: 380, y: 300 }, [])).toEqual({ side: "left", slide: 0 });
  });

  it("moves off an area's name to the dot's other side", () => {
    // The dot is in the right half, and the base's name runs under where its own would go on the left.
    expect(place({ x: 300, y: 300 }, [areaAt(180)])).toEqual({ side: "right", slide: 0 });
  });

  it("goes above the dot when names are on both sides", () => {
    expect(place({ x: 300, y: 300 }, [areaAt(180), areaAt(310, "Juhu")])).toEqual({ side: "above", slide: 0 });
  });

  it("slides a name above the dot back inside the frame", () => {
    // Near the right edge, with the left side taken: centred over the dot it would run 22.3 past the edge.
    expect(place({ x: 460, y: 300 }, [areaAt(340)])).toEqual({ side: "above", slide: -22.3 });
  });

  it("goes below the dot when above runs off the top", () => {
    const sides = [areaAt(180, "Kurla West", 30), areaAt(380, "Juhu", 30, "left")];
    expect(place({ x: 300, y: 30 }, sides)).toEqual({ side: "below", slide: 0 });
  });

  it("takes the place that hides least when nowhere is clear", () => {
    // A map too small for the name anywhere, with the credit across its lower half: above loses only its top 10.
    expect(place({ x: 50, y: 30 }, [], 100, 60)).toEqual({ side: "above", slide: 0 });
  });
});

describe("mapName", () => {
  it("labels a pin with the place's own name, without what Qloo adds after it", () => {
    expect(mapName("Fresh Catch By Francis - Coastal and Seafood Restaurant")).toBe("Fresh Catch By Francis");
    expect(mapName("Poco Loco Tapas & Bar, Khar")).toBe("Poco Loco Tapas & Bar");
    expect(mapName("Joe's Pizza (Broadway)")).toBe("Joe's Pizza");
    expect(mapName("Hotel | Rooftop Bar")).toBe("Hotel");
  });

  it("keeps a name that has nothing added, or would be left too short", () => {
    for (const name of ["Bombay Salad Co.", "McDonald's", "A-1 Diner", "Nehru Nagar ST Stand Canteen"]) expect(mapName(name)).toBe(name);
    expect(mapName("Q - The Bar")).toBe("Q - The Bar");
  });
});
