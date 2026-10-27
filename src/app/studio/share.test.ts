import { describe, expect, it } from "vitest";
import { shareLinks } from "./share";

describe("shareLinks", () => {
  const url = "https://itsgiving-two.vercel.app/t/prateek-kuhad-mumbai";

  it("sends the title and the link, encoded, to WhatsApp", () => {
    const { whatsapp } = shareLinks(url, "Almost, In Bandra & More");
    const link = new URL(whatsapp);
    expect(link.origin).toBe("https://wa.me");
    expect(link.searchParams.get("text")).toBe(`Almost, In Bandra & More, a treatment on itsgiving: ${url}`);
  });

  it("writes an email with the title as its subject and the link in its body, to no one until they pick", () => {
    const { email } = shareLinks(url, "Rain on Canal Street?");
    const mail = new URL(email);
    expect(mail.protocol).toBe("mailto:");
    expect(mail.pathname).toBe("");
    expect(mail.searchParams.get("subject")).toBe("Rain on Canal Street?, a treatment on itsgiving");
    expect(mail.searchParams.get("body")).toBe(`Rain on Canal Street?, a treatment on itsgiving\n\n${url}`);
  });
});
