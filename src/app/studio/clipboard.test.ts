import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("copies through the clipboard and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("#2E5E5A")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("#2E5E5A");
  });

  it("reports a refusal instead of throwing, so the control can show the text to copy by hand", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) } });
    expect(await copyText("#2E5E5A")).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await copyText("#2E5E5A")).toBe(false);
  });
});
