// The itsgiving mark: a lime cinema camera, a big feed reel and a smaller take-up reel over the body, and the matte
// box in front. The same shapes as src/app/icon.svg, which the favicon and the touch icon are rendered from; here
// cropped to the camera alone, to sit on an ink tile its user draws. A plain module, so the share card can use it too.

const LIME = "#e4ff3a";
const INK = "#121211";

const REELS = [
  { cx: 21, cy: 23, r: 9, window: 2.1, reach: 4.6 },
  { cx: 38.5, cy: 25, r: 7.2, window: 1.65, reach: 3.65 },
];

/** Three windows in each reel, one at the top and two below. */
const WINDOWS = REELS.flatMap(({ cx, cy, window, reach }) =>
  [-90, 30, 150].map((deg) => ({
    cx: cx + reach * Math.cos((deg * Math.PI) / 180),
    cy: cy + reach * Math.sin((deg * Math.PI) / 180),
    r: window,
  })),
);

/** 43 by 36 units; give it a height (or width) and it keeps its shape. */
export function CameraMark({ height, width }: { height?: number; width?: number }) {
  return (
    <svg aria-hidden viewBox="11 14 43 36" height={height} width={width ?? (height ? (height * 43) / 36 : undefined)}>
      <g fill={LIME}>
        {REELS.map((reel) => (
          <circle key={reel.cx} cx={reel.cx} cy={reel.cy} r={reel.r} />
        ))}
        <rect x="11" y="33" width="32" height="17" rx="3.5" />
        <path d="M42 39 54 33v17l-12-6z" />
      </g>
      <g fill={INK}>
        {WINDOWS.map((w) => (
          <circle key={`${w.cx}:${w.cy}`} cx={w.cx} cy={w.cy} r={w.r} />
        ))}
      </g>
    </svg>
  );
}
