import type { MouseEvent } from "react";
import { jumpOnClick, onScreen } from "./jump";

/** The site's sections, the same in the header and the footer. The examples live on the homepage's strip. */
export const NAV = [
  { id: "examples", href: "/#now-showing", label: "Examples" },
  { id: "studio", href: "/studio", label: "Studio" },
  { id: "about", href: "/about", label: "About" },
] as const;

export type Section = (typeof NAV)[number]["id"];

/**
 * The Examples link's click. On the homepage the strip is on this page, and Next does nothing for a link to the
 * address it's already on, so the link jumps there itself, every time. It reads the address only when clicked, so a
 * page that shows the link stays as static as before.
 */
export function toExamples(event: MouseEvent<HTMLAnchorElement>) {
  if (location.pathname === "/") jumpOnClick(event, onScreen("now-showing"));
}
