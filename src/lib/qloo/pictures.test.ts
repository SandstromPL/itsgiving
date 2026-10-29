import { describe, expect, it } from "vitest";
import type { CompactEntity } from "./normalize";
import { missingPictures } from "./pictures";

const person = (id: string, image?: string) => ({ id, name: id, tags: [], ...(image ? { image } : {}) }) as CompactEntity;

describe("missingPictures", () => {
  it("finds the pictures Qloo's image server answers with its placeholder, and keeps any it can't ask about", async () => {
    const asked: { url: string; redirect?: RequestRedirect }[] = [];
    const missing = await missingPictures(
      [
        person("kept", "https://images.qloo.com/i/kept.jpg"),
        person("oops", "https://images.qloo.com/i/oops.jpg"),
        person("gone", "https://images.qloo.com/i/gone.jpg"),
        person("down", "https://images.qloo.com/i/down.jpg"),
        person("none"),
        person("mock", "/mock/still.svg"),
      ],
      {
        fetch: async (url, init) => {
          asked.push({ url, redirect: init?.redirect });
          if (url.endsWith("oops.jpg")) return new Response(null, { status: 307, headers: { location: "/s/oops.png" } });
          if (url.endsWith("gone.jpg")) return new Response(null, { status: 404 });
          if (url.endsWith("down.jpg")) throw new TypeError("fetch failed");
          return new Response("jpeg", { status: 200, headers: { "content-type": "image/jpeg" } });
        },
      },
    );
    expect([...missing].sort()).toEqual(["gone", "oops"]);
    expect(asked).toHaveLength(4);
    expect(asked.every((a) => a.redirect === "manual")).toBe(true);
  });
});
