// Colours worked out from a treatment's palette, shared by the pages (as CSS) and the share card (as hex: its renderer
// has no color-mix()). A plain module, so server routes can import it as well as client components.

const INK = "#121211";
const HEX = /^#[0-9a-f]{6}$/i;

/** How bright a #rrggbb colour looks (Rec. 709 weights), for finding a palette's darkest. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** The darkest well-formed colour of a palette, if it has one. */
function darkest(palette: readonly string[]): string | undefined {
  return palette.filter((hex) => HEX.test(hex)).sort((a, b) => luminance(a) - luminance(b))[0];
}

/** `a` mixed into `b` by `share`, as hex. */
export function mixHex(a: string, b: string, share: number): string {
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

/** A poster's colour: the palette's darkest mixed toward ink, so white type always holds on it. As CSS. */
export function darkOf(palette: readonly string[]): string {
  const dark = darkest(palette);
  return dark ? `color-mix(in srgb, ${dark} 55%, ${INK})` : INK;
}

/** The same colour as hex, for the share card. A palette with no colour gets the card's own dark grey. */
export function darkHex(palette: readonly string[]): string {
  const dark = darkest(palette);
  return dark ? mixHex(dark, INK, 0.55) : "#2a2926";
}
