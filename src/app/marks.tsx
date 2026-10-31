import { useId } from "react";
import { GLYPHS } from "./lettermark-glyphs";

// The two marks. 2B, the lettermark, is the wordmark: "itsgiving" outlined from Bricolage Grotesque 800, both g's
// upper bowls cut as five-hole reels. 2C, the camera, is the icon: a big feed reel and a smaller take-up reel over the
// body and the matte box (the same shapes as src/app/icon.svg). Both draw in plain SVG, so a server page can use them;
// the camera cut (cut.ts) draws the camera from the same numbers.

const rad = (deg: number) => (deg * Math.PI) / 180;
const n = (v: number) => Math.round(v * 100) / 100;

/* ---------- 2B: the lettermark ---------- */

/** The g's reel, in glyph units: five holes round a hub, cut from its upper bowl. */
const G = { cx: 280, cy: -344, reach: 79, win: 26.5, hub: 16, holes: [-90, -18, 54, 126, 198] };
const TRACK = -22;
const LETTERS = (() => {
  let x = 0;
  const list: { ch: string; x: number }[] = [];
  for (const ch of "itsgiving") {
    list.push({ ch, x });
    x += GLYPHS[ch].adv + TRACK;
  }
  return { list, width: x - TRACK };
})();
const G_AT = LETTERS.list.filter((l) => l.ch === "g").map((l) => l.x);

/** The lettermark's viewBox in glyph units (baseline at y 0): `[x, y, width, height]`. */
export const LETTERMARK_BOX = [25, -770, Math.round(LETTERS.width - 34), 972] as const;

/** A g's top hole at reel angle `angle` (degrees), in glyph units: the second g's is the take-up reel's window. */
export function lettermarkPortal(angle = 0, which = 1) {
  const x = G_AT[which];
  const t = rad(-90 + angle);
  return { cx: x + G.cx + G.reach * Math.cos(t), cy: G.cy + G.reach * Math.sin(t), r: G.win };
}

/**
 * The wordmark, in currentColor, with the g's holes cut out by a mask so whatever is behind shows through. `reels`
 * turns each g's holes (degrees). With `letters`, each letter is its own `<g class="wl" style="--i:n">`, for a rack
 * focus; the holes are masked inside their own letter, so they move with it. Each reel's holes sit in a group marked
 * `data-reel`, which a scene can turn without a render.
 */
export function Lettermark({
  className,
  title,
  reels = [0, 0],
  letters = false,
}: {
  className?: string;
  /** Read out instead of hiding the mark: give it when the mark is the only name on screen. */
  title?: string;
  reels?: [number, number];
  letters?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [bx, by, bw, bh] = LETTERMARK_BOX;
  let reel = 0;
  return (
    <svg
      className={className}
      viewBox={LETTERMARK_BOX.join(" ")}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="currentColor"
    >
      <defs>
        {G_AT.map((x, r) => (
          <mask key={x} id={`${id}-g${r}`} maskUnits="userSpaceOnUse" x={bx} y={by} width={bw} height={bh}>
            <rect x={bx} y={by} width={bw} height={bh} fill="#fff" />
            <g data-reel={r} data-c={`${x + G.cx} ${G.cy}`} transform={`rotate(${n(reels[r] ?? 0)} ${x + G.cx} ${G.cy})`}>
              {G.holes.map((d) => (
                <circle
                  key={d}
                  cx={n(x + G.cx + G.reach * Math.cos(rad(d)))}
                  cy={n(G.cy + G.reach * Math.sin(rad(d)))}
                  r={G.win}
                  fill="#000"
                />
              ))}
              <circle cx={x + G.cx} cy={G.cy} r={G.hub} fill="#000" />
            </g>
          </mask>
        ))}
      </defs>
      {LETTERS.list.map(({ ch, x }, i) => {
        const glyph = GLYPHS[ch];
        // A mask works in the user space of the element that uses it, after that element's own transform, so the g's
        // mask sits on a group of its own around the moved letter, in the same space as the holes' numbers.
        const body =
          ch === "g" ? (
            <g mask={`url(#${id}-g${reel++})`}>
              <path transform={`translate(${x} 0)`} d={glyph.d} fillRule="evenodd" />
            </g>
          ) : (
            <path transform={`translate(${x} 0)`} d={glyph.d} />
          );
        return letters ? (
          <g key={i} className="wl" style={{ ["--i" as string]: i }}>
            {body}
          </g>
        ) : (
          <g key={i}>{body}</g>
        );
      })}
    </svg>
  );
}

/* ---------- 2C: the camera ---------- */

export const CAMERA = {
  box: [11, 14, 43, 36] as const,
  reels: [
    { cx: 21, cy: 23, r: 9, win: 2.1, reach: 4.6 },
    { cx: 38.5, cy: 25, r: 7.2, win: 1.65, reach: 3.65 },
  ],
  /** Both reels carry the same film, so the smaller one turns 9 / 7.2 times as fast. */
  ratio: 9 / 7.2,
  /** A window comes round every 120 degrees. */
  spacing: 120,
};

const reelWindows = (reel: (typeof CAMERA.reels)[number]) =>
  [-90, 30, 150].map((d) => ({
    cx: n(reel.cx + reel.reach * Math.cos(rad(d))),
    cy: n(reel.cy + reel.reach * Math.sin(rad(d))),
    r: reel.win,
  }));

/** The camera as SVG markup, for scenes drawn without React (the cut); each reel's windows in a `data-reel` group. */
export function cameraMarkup(fg: string, bg: string, angles: [number, number] = [0, 0]) {
  const [r1, r2] = CAMERA.reels;
  const windows = (reel: typeof r1, i: number) =>
    `<g data-reel="${i}" transform="rotate(${n(angles[i])} ${reel.cx} ${reel.cy})">${reelWindows(reel)
      .map((w) => `<circle cx="${w.cx}" cy="${w.cy}" r="${w.r}" fill="${bg}"/>`)
      .join("")}</g>`;
  return (
    `<g fill="${fg}"><circle cx="${r1.cx}" cy="${r1.cy}" r="${r1.r}"/><circle cx="${r2.cx}" cy="${r2.cy}" r="${r2.r}"/>` +
    `<rect x="11" y="33" width="32" height="17" rx="3.5"/><path d="M42 39 54 33v17l-12-6z"/></g>` +
    windows(r1, 0) +
    windows(r2, 1)
  );
}

/** The feed reel's top window at reel angle `angle`: the opening a cut goes through. */
export function cameraPortal(angle: number) {
  const r = CAMERA.reels[0];
  const t = rad(-90 + angle);
  return { cx: r.cx + r.reach * Math.cos(t), cy: r.cy + r.reach * Math.sin(t), r: r.win };
}

/** The camera on its rounded tile, in the room's mark colours: the header's icon. */
export function CameraTile({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="15" style={{ fill: "var(--mark-tile)" }} />
      <g style={{ fill: "var(--mark)" }}>
        {CAMERA.reels.map((reel) => (
          <circle key={reel.cx} cx={reel.cx} cy={reel.cy} r={reel.r} />
        ))}
        <rect x="11" y="33" width="32" height="17" rx="3.5" />
        <path d="M42 39 54 33v17l-12-6z" />
      </g>
      <g style={{ fill: "var(--mark-tile)" }}>
        {CAMERA.reels
          .flatMap((reel) => reelWindows(reel))
          .map((w) => (
            <circle key={`${w.cx}:${w.cy}`} cx={w.cx} cy={w.cy} r={w.r} />
          ))}
      </g>
    </svg>
  );
}
