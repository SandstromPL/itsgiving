import { ImageResponse } from "next/og";
import { featuredCovers, loadFeatured, type FeaturedCover } from "@/lib/agent/featured";
import { llmConfigFromEnv } from "@/lib/llm/config";
import { qlooConfigFromEnv } from "@/lib/qloo";
import { CameraMark } from "./studio/mark";

// The card a shared link shows: the promise, and the featured treatments as posters when the server has them.

export const alt =
  "itsgiving: your voice, their taste. Treatments for music-video and short-film directors, grounded in Qloo's taste graph.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#121211";
const ACCENT = "#e4ff3a";
const HEADLINE = ["your voice,", "their taste."];
const STICKER = "for music-video and short-film directors";

/** `a` mixed into `b` by `share`, as hex: the image renderer has no color-mix(). */
function mix(a: string, b: string, share: number): string {
  const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v * share + y[i] * (1 - share))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The poster's colour, as on the landing: the palette's darkest, mixed toward ink. */
function posterColour(palette: string[]): string {
  const luminance = (hex: string) => {
    const n = Number.parseInt(hex.slice(1, 7), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  const darkest = [...palette].filter((hex) => /^#[0-9a-f]{6}$/i.test(hex)).sort((a, b) => luminance(a) - luminance(b))[0];
  return darkest ? mix(darkest, INK, 0.55) : "#2a2926";
}

/**
 * Bricolage Grotesque at 800, cut to the characters the card uses. The renderer can't read WOFF2, and Google Fonts
 * serves TrueType to a client that doesn't ask for it; without the font, the card falls back to the default face. Both
 * fetches are cached, so the card is drawn once per deploy, not per visitor.
 */
async function bricolage(text: string): Promise<ArrayBuffer | undefined> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&text=${encodeURIComponent(text)}`, {
        cache: "force-cache",
      })
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url, { cache: "force-cache" })).arrayBuffer() : undefined;
  } catch {
    return undefined;
  }
}

const TILT = [-5, 4, -2];
// Three posters fanned out on the right, clear of the headline and of each other's titles.
const PLACES = [
  { right: 300, top: 50 },
  { right: 50, top: 30 },
  { right: 175, top: 330 },
];

function Poster({ cover, i }: { cover: FeaturedCover; i: number }) {
  return (
    <div
      style={{
        position: "absolute",
        right: PLACES[i].right,
        top: PLACES[i].top,
        width: 210,
        height: 262,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        borderRadius: 22,
        overflow: "hidden",
        background: posterColour(cover.palette),
        transform: `rotate(${TILT[i]}deg)`,
        boxShadow: "0 18px 40px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 18 }}>
        {cover.tone && (
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              background: ACCENT,
              color: INK,
              fontSize: 15,
              padding: "5px 9px",
              borderRadius: 9,
              transform: "rotate(-3deg)",
            }}
          >
            {`it's giving ${cover.tone.toLowerCase()}`}
          </div>
        )}
        <div style={{ display: "flex", color: "#ffffff", fontSize: 28, lineHeight: 0.95, letterSpacing: "-0.04em" }}>{cover.title}</div>
      </div>
      <div style={{ display: "flex", height: 12 }}>
        {cover.palette.slice(0, 6).map((hex) => (
          <div key={hex} style={{ display: "flex", flex: 1, background: hex }} />
        ))}
      </div>
    </div>
  );
}

export default async function Image() {
  const live = qlooConfigFromEnv().mode === "live" && llmConfigFromEnv().mode === "live";
  const covers = live ? featuredCovers(loadFeatured()).slice(0, 3) : [];
  const domain = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "";
  const text = [
    "itsgiving",
    ...HEADLINE,
    STICKER,
    domain,
    ...covers.flatMap((c) => [c.title, `it's giving ${c.tone?.toLowerCase() ?? ""}`]),
  ].join(" ");
  const font = await bricolage(text);
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: INK,
        fontFamily: font ? "Bricolage Grotesque" : undefined,
      }}
    >
      <div style={{ position: "absolute", left: 64, top: 56, display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 50,
            height: 38,
            borderRadius: 10,
            background: "#2a2926",
          }}
        >
          <CameraMark height={25} />
        </div>
        <div style={{ display: "flex", color: "#ffffff", fontSize: 38, letterSpacing: "-0.045em" }}>itsgiving</div>
      </div>
      {covers.map((cover, i) => (
        <Poster key={cover.slug} cover={cover} i={i} />
      ))}
      <div style={{ position: "absolute", left: 64, bottom: 76, display: "flex", flexDirection: "column", gap: 26 }}>
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            background: ACCENT,
            color: INK,
            fontSize: 22,
            padding: "8px 14px",
            borderRadius: 12,
            transform: "rotate(-3deg)",
          }}
        >
          {STICKER}
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", color: "#ffffff", fontSize: 112, lineHeight: 0.88, letterSpacing: "-0.055em" }}
        >
          {HEADLINE.map((line) => (
            <div key={line} style={{ display: "flex" }}>
              {line}
            </div>
          ))}
        </div>
      </div>
      {domain && (
        <div style={{ position: "absolute", left: 66, bottom: 32, display: "flex", color: "#aaa498", fontSize: 18 }}>{domain}</div>
      )}
    </div>,
    { ...size, fonts: font ? [{ name: "Bricolage Grotesque", data: font, style: "normal", weight: 800 }] : undefined },
  );
}
