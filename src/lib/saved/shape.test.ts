import { describe, expect, it } from "vitest";
import type { Treatment } from "../agent/types";
import { SAVE_BODY_LIMIT, coverOf, fromElsewhere, isSavedId, readSaveRequest, sentJson, summaryOf, takeKey } from "./shape";

describe("requests that change saved treatments", () => {
  it("come only from this site's own pages", () => {
    expect(fromElsewhere(new Headers({ "sec-fetch-site": "same-origin" }))).toBe(false);
    // Not a browser (curl, a test): it holds no one's cookies, so the session check decides.
    expect(fromElsewhere(new Headers())).toBe(false);
    for (const site of ["same-site", "cross-site", "none"]) expect(fromElsewhere(new Headers({ "sec-fetch-site": site }))).toBe(true);
  });

  it("send JSON, which a cross-site form can't", () => {
    expect(sentJson(new Headers({ "content-type": "application/json" }))).toBe(true);
    expect(sentJson(new Headers({ "content-type": "application/json; charset=utf-8" }))).toBe(true);
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"])
      expect(sentJson(new Headers({ "content-type": type }))).toBe(false);
    expect(sentJson(new Headers())).toBe(false);
  });
});

/** Just enough of a treatment for the saving code: the seal vouches for the rest. */
function treatment(overrides: Record<string, unknown> = {}): Treatment {
  return {
    id: "a1b2c3",
    createdAt: "2026-10-26T18:00:00.000Z",
    title: "Almost, in Bandra",
    brief: { format: "music_video", city: "Mumbai" },
    references: [{ entity: { name: "Masaan" } }, { entity: { name: "Lunchbox" }, still: "https://image.tmdb.org/t/p/w1280/x.jpg" }],
    subjects: [{ name: "Prateek Kuhad", kind: "artist" }],
    who: { artists: ["Prateek Kuhad"], films: [], standIns: [] },
    ...overrides,
  } as unknown as Treatment;
}

describe("saving a treatment", () => {
  it("reads a sealed treatment, returning the JSON as sent rather than the validator's copy", () => {
    const sent = treatment({ zzz: "kept", aaa: 1 });
    const read = readSaveRequest(JSON.stringify({ treatment: sent, seal: "seal" }));
    expect(read.ok).toBe(true);
    // The seal is over the text, key order and all.
    if (read.ok) expect(JSON.stringify(read.treatment)).toBe(JSON.stringify(sent));
  });

  it("refuses anything that isn't a treatment and its seal", () => {
    expect(readSaveRequest("{ not json")).toMatchObject({ ok: false, status: 400 });
    expect(readSaveRequest(JSON.stringify({ treatment: treatment() }))).toMatchObject({ ok: false, status: 400 });
    expect(readSaveRequest(JSON.stringify({ treatment: treatment({ title: "" }), seal: "s" }))).toMatchObject({ ok: false });
    expect(readSaveRequest(JSON.stringify({ treatment: treatment({ brief: { format: "ad", city: "Mumbai" } }), seal: "s" }))).toMatchObject(
      {
        ok: false,
      },
    );
    expect(readSaveRequest(JSON.stringify({ treatment: "<html>", seal: "s" }))).toMatchObject({ ok: false });
  });

  it("refuses a body over the limit before reading it", () => {
    expect(readSaveRequest("x".repeat(SAVE_BODY_LIMIT + 1))).toMatchObject({ ok: false, status: 413 });
  });

  it("knows a take by its brief key and build time", () => {
    expect(takeKey(treatment())).toBe("a1b2c3:2026-10-26T18:00:00.000Z");
    expect(takeKey(treatment({ createdAt: "2026-10-27T09:00:00.000Z" }))).not.toBe(takeKey(treatment()));
  });

  it("keeps a line and a picture for the list", () => {
    expect(summaryOf(treatment())).toBe("Music video for Prateek Kuhad, Mumbai");
    expect(
      summaryOf(treatment({ brief: { format: "short_film", city: "Mumbai" }, who: { artists: [], films: ["Past Lives"], standIns: [] } })),
    ).toBe("Short film after Past Lives, Mumbai");
    expect(coverOf(treatment())).toBe("https://image.tmdb.org/t/p/w1280/x.jpg");
    expect(coverOf(treatment({ references: [] }))).toBeNull();
  });

  it("only takes a UUID as a saved treatment's address", () => {
    expect(isSavedId("0b4f7e2a-9c1d-4e5f-8a6b-7c8d9e0f1a2b")).toBe(true);
    for (const id of ["", "1", "../etc", "0b4f7e2a-9c1d-4e5f-8a6b-7c8d9e0f1a2b'--", "0B4F7E2A9C1D4E5F8A6B7C8D9E0F1A2B"])
      expect(isSavedId(id)).toBe(false);
  });
});
