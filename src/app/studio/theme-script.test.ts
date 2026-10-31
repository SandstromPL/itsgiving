import { describe, expect, it } from "vitest";
import { THEME_SCRIPT } from "./theme-script";

/** Runs the pre-paint script against a stand-in <html> and storage, and returns what it set. */
function run(stored: Record<string, string>, session: Record<string, string> = {}) {
  const dataset: Record<string, string> = {};
  const document = { documentElement: { dataset } };
  const localStorage = { getItem: (key: string) => stored[key] ?? null };
  const sessionStorage = { getItem: (key: string) => session[key] ?? null };
  new Function("document", "localStorage", "sessionStorage", THEME_SCRIPT)(document, localStorage, sessionStorage);
  return dataset;
}

describe("the room script", () => {
  it("leaves grade, the default, unmarked and dark", () => {
    expect(run({})).toEqual({ theme: "dark" });
  });

  it("applies a saved room", () => {
    expect(run({ "itsgiving:room": "tungsten" })).toEqual({ room: "tungsten", theme: "dark" });
    expect(run({ "itsgiving:room": "light" })).toEqual({ room: "light", theme: "light" });
  });

  it("keeps light for a visitor who chose it under the old switch, and the old dark is grade", () => {
    expect(run({ "itsgiving:theme": "light" })).toEqual({ room: "light", theme: "light" });
    expect(run({ "itsgiving:theme": "dark" })).toEqual({ theme: "dark" });
  });

  it("ignores a room it doesn't know", () => {
    expect(run({ "itsgiving:room": "sodium" })).toEqual({ theme: "dark" });
  });

  it("marks the homepage intro as seen in this tab", () => {
    expect(run({}, { "itsgiving:intro": "1" })).toEqual({ theme: "dark", intro: "seen" });
  });
});
