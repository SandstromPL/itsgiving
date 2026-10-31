import { describe, expect, it } from "vitest";
import { awayBox, edgePoint, frameBounds, mapName, placeLabels, placePinName } from "./base-map";
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

describe("frameBounds", () => {
  // Kerala as live Qloo maps one audience (2026-10-31): two strong areas 88 km apart, so a grid framed on both.
  const area = (ref: string, name: string, lat: number, lon: number) => ({
    ref,
    rank: Number(ref.slice(1)),
    name,
    near: [],
    lat,
    lon,
    radius_m: 2000,
    share: 0.1,
  });
  const kochi = area("A1", "Kochi", 9.9658, 76.2421);
  const thrissur = area("A2", "Thrissur", 10.5276, 76.2144);
  // A city's grid has squares of a few hundred metres; a state's, Qloo's own 5 km tiles.
  const grid = (south: number, west: number, north: number, east: number, cell = 0.044) => ({
    bounds: { south, west, north, east },
    cell: { lat: cell, lon: cell },
    tiles: [{ lat: south, lon: west, heat: 1 }],
  });
  const kmAcross = (b: { south: number; north: number; west: number; east: number }) =>
    Math.max((b.north - b.south) * 111.32, (b.east - b.west) * 111.32 * Math.cos((((b.north + b.south) / 2) * Math.PI) / 180));

  it("keeps the grid's own frame when every area is near the base, as on the examples", () => {
    const map = grid(18.9, 72.78, 19.1, 72.92, 0.005);
    const base = { chosen: "A1", held: true, areas: [area("A1", "Bandra West", 19.06, 72.83), area("A2", "Churchgate", 18.93, 72.83)] };
    expect(frameBounds(map, [{ n: 1, name: "Cafe", lat: 19.061, lon: 72.831 }], base)).toEqual(map.bounds);
  });

  it("frames the base, not a strong area 88 km away or a location 60 km away", () => {
    const map = grid(9.93, 76.17, 10.56, 76.29);
    const base = { chosen: "A1", held: false, areas: [kochi, thrissur] };
    const pins = [
      { n: 1, name: "Near", lat: 9.975, lon: 76.25 },
      { n: 2, name: "Far", lat: 10.5, lon: 76.2 },
    ];
    const framed = frameBounds(map, pins, base);
    expect(kmAcross(framed)).toBeLessThan(12);
    expect(framed.south).toBeLessThan(kochi.lat);
    expect(framed.north).toBeGreaterThan(9.975);
    expect(framed.north).toBeLessThan(10.2);
  });
});

describe("edgePoint", () => {
  const credit = { width: 200, height: 34 };

  it("draws a location beyond the frame on its edge, toward where it is", () => {
    expect(edgePoint({ x: 300, y: 300 }, { x: 1500, y: 300 }, 600, 600, 18, credit)).toEqual({ x: 582, y: 300 });
    expect(edgePoint({ x: 300, y: 300 }, { x: 300, y: -900 }, 600, 600, 18, credit)).toEqual({ x: 300, y: 18 });
  });

  it("lifts it above the OpenStreetMap credit in the bottom-right corner", () => {
    const at = edgePoint({ x: 300, y: 300 }, { x: 1500, y: 1500 }, 600, 600, 18, credit);
    expect(at.x).toBe(582);
    expect(at.y).toBe(600 - 34 - 18);
  });
});

describe("awayBox", () => {
  it("keeps an area's name off a distance tag at the frame's edge", () => {
    // A location 35 km away drawn at the left edge, its tag running right, over where the base's name would go.
    const pin = { x: 18, y: 84 };
    const tag = awayBox(pin, "35 km", W, H);
    expect(tag.left).toBeGreaterThan(pin.x);
    const ring = { name: "Ashutosh Nagar", x: 80, y: 130, r: 40 };
    expect(placeLabels([ring], [pin], W, H)).toEqual([{ side: "above", along: 0 }]);
    expect(placeLabels([ring], [pin], W, H, 1, [tag])).not.toEqual([{ side: "above", along: 0 }]);
  });
});
