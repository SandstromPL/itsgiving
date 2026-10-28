import { describe, expect, it } from "vitest";
import { z } from "zod";
import { problem, readJson, tooMany } from "./http";

const post = (body: string) => new Request("https://itsgiving.test/api/x", { method: "POST", body });
const schema = z.strictObject({ source: z.string().trim().min(1) });

describe("problem", () => {
  it("answers { error } as JSON with the status, plus any headers", async () => {
    const plain = problem(403, "Saving works only from itsgiving's own pages.");
    expect(plain.status).toBe(403);
    expect(plain.headers.get("content-type")).toBe("application/json");
    expect(await plain.json()).toEqual({ error: "Saving works only from itsgiving's own pages." });

    const withHeader = problem(429, "Slow down.", { "retry-after": "7" });
    expect(withHeader.headers.get("retry-after")).toBe("7");
    expect(withHeader.headers.get("content-type")).toBe("application/json");
  });
});

describe("tooMany", () => {
  it("says how long to wait in whole seconds, rounded up, in the words and in Retry-After", async () => {
    const response = tooMany("saves", 1_500);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toEqual({ error: "Too many saves at once. Try again in 2 s." });

    const full = tooMany("treatments", 60_000);
    expect(full.headers.get("retry-after")).toBe("60");
    expect(await full.json()).toEqual({ error: "Too many treatments at once. Try again in 60 s." });
  });
});

describe("readJson", () => {
  it("gives back the schema's output when the body fits", async () => {
    expect(await readJson(post('{"source":"  tt0118694  "}'), schema, { invalid: "Paste a link." })).toEqual({ source: "tt0118694" });
  });

  it("refuses a body that isn't JSON, in the same words for every route", async () => {
    const answer = await readJson(post("{ not json"), schema, { invalid: "Paste a link." });
    expect(answer).toBeInstanceOf(Response);
    const response = answer as Response;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The request body must be JSON." });
  });

  it("refuses JSON that doesn't fit the schema with the route's words, or words made from zod's error", async () => {
    const fixed = (await readJson(post('{"source":""}'), schema, { invalid: "Paste a link." })) as Response;
    expect(fixed.status).toBe(400);
    expect(await fixed.json()).toEqual({ error: "Paste a link." });

    const worded = (await readJson(post('{"source":"x","extra":1}'), schema, {
      invalid: (error) => `${error.issues.length} problem: ${error.issues[0].code}`,
    })) as Response;
    expect(worded.status).toBe(400);
    expect(await worded.json()).toEqual({ error: "1 problem: unrecognized_keys" });
  });

  it("refuses a body over the limit with 413 before reading it as JSON, and takes one exactly at it", async () => {
    const tooLarge = { length: 20, message: "That's too much text." };
    const over = (await readJson(post(`{"source":"${"x".repeat(20)}"}`), schema, { invalid: "Paste a link.", tooLarge })) as Response;
    expect(over.status).toBe(413);
    expect(await over.json()).toEqual({ error: "That's too much text." });
    // Over the limit and not JSON either: the size is what's reported.
    expect(((await readJson(post("x".repeat(21)), schema, { invalid: "Paste a link.", tooLarge })) as Response).status).toBe(413);

    const atLimit = '{"source":"abcdefg"}';
    expect(atLimit).toHaveLength(20);
    expect(await readJson(post(atLimit), schema, { invalid: "Paste a link.", tooLarge })).toEqual({ source: "abcdefg" });
    // Without a limit, any length is read.
    expect(await readJson(post(`{"source":"${"x".repeat(5_000)}"}`), schema, { invalid: "Paste a link." })).toEqual({
      source: "x".repeat(5_000),
    });
  });
});
