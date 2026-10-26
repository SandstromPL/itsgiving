import { describe, expect, it } from "vitest";
import { returnPath } from "./config";

describe("returnPath", () => {
  it("goes back to a path on this site, query and all", () => {
    expect(returnPath("/studio")).toBe("/studio");
    expect(returnPath("/s/0b4f7e2a-9c1d-4e5f-8a6b-7c8d9e0f1a2b?x=1#top")).toBe("/s/0b4f7e2a-9c1d-4e5f-8a6b-7c8d9e0f1a2b?x=1#top");
  });

  it("never leaves the site, whatever the link says", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "evil",
      "/ /x",
      "\\\\evil",
      "/%0d%0aSet-Cookie:x",
      // Dot segments that collapse into "//evil.example".
      "/.//evil.example",
      "/..//evil.example",
      "/a/..//evil.example",
      "/%2e//evil.example",
      "/%2E%2E//evil.example",
    ]) {
      expect(returnPath(next)).toMatch(/^\/(?!\/)/);
      expect(returnPath(next).includes("evil.example")).toBe(false);
    }
    expect(returnPath(null)).toBe("/");
    expect(returnPath("")).toBe("/");
  });
});
