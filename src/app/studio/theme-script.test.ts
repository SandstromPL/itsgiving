import { describe, expect, it } from "vitest";
import { THEME_SCRIPT } from "./theme-script";

/** Runs the pre-paint script against a stand-in <html> and storage, and returns what it set. */
function run(stored: Record<string, string>) {
  const dataset: Record<string, string> = {};
  const document = { documentElement: { dataset } };
  const localStorage = { getItem: (key: string) => stored[key] ?? null };
  new Function("document", "localStorage", THEME_SCRIPT)(document, localStorage);
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
});
