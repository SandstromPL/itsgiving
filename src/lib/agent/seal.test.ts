import { describe, expect, it } from "vitest";
import { sealHolds, sealOf, sealerFromEnv } from "./seal";

const secret = "sb_secret_test-value";
const treatment = {
  id: "abc123",
  createdAt: "2026-10-26T18:00:00.000Z",
  title: "Almost, in Bandra",
  palette: [{ hex: "#123456" }],
  score: 0.1 + 0.2,
};

describe("seal", () => {
  it("holds for the treatment it was made for, after the trip to the browser and back", () => {
    const seal = sealOf(treatment, secret);
    // The browser parses the event and sends the treatment back as JSON: the same text, so the same seal.
    const returned = JSON.parse(JSON.stringify({ treatment, seal }));
    expect(sealHolds(returned.treatment, returned.seal, secret)).toBe(true);
  });

  it("breaks when anything in the treatment changes", () => {
    const seal = sealOf(treatment, secret);
    expect(sealHolds({ ...treatment, title: "Something else" }, seal, secret)).toBe(false);
    expect(sealHolds({ ...treatment, palette: [{ hex: "#123457" }] }, seal, secret)).toBe(false);
    expect(sealHolds({ ...treatment, extra: "<img src=x>" }, seal, secret)).toBe(false);
  });

  it("holds only under the secret that made it", () => {
    expect(sealHolds(treatment, sealOf(treatment, secret), "sb_secret_other")).toBe(false);
  });

  it("refuses anything that isn't a seal", () => {
    for (const seal of [undefined, null, 42, "", "short", `${sealOf(treatment, secret)}x`]) {
      expect(sealHolds(treatment, seal, secret)).toBe(false);
    }
  });

  it("seals only when the secret key is set", () => {
    expect(sealerFromEnv({})).toBeUndefined();
    expect(sealerFromEnv({ SUPABASE_SECRET_KEY: "  " })).toBeUndefined();
    expect(sealerFromEnv({ SUPABASE_SECRET_KEY: secret })?.(treatment)).toBe(sealOf(treatment, secret));
  });
});
