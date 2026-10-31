import type { MouseEvent } from "react";
import { scrollToY } from "../smooth";

// In-page links: the board's section bar and the homepage's Examples link. Two things make the browser's own "#id"
// jump wrong here. Next keeps the pages it leaves in the document, hidden, ids and all, so an id can find a hidden
// copy first. And a "#id" link adds a history entry with no state: Next ignores Back and Forward onto it (the page left
// behind stays on screen under this one's address), and the studio would read it as leaving the board.

/** The element with this id that's on screen, not a copy on a page Next keeps hidden. */
export function onScreen(id: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`#${CSS.escape(id)}`)) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

/**
 * Jumps to an element without a new history entry: the current entry keeps its state and takes the element's address,
 * so the address can be shared and Back still leaves the page. Focus moves to its heading, as a link's own jump moves
 * where the keyboard goes next, and a keyboard's focus ring then circles the heading rather than a whole section.
 */
export function jumpTo(target: HTMLElement) {
  // Through smooth scrolling when it runs, so a glide in progress doesn't pull the page back after the jump.
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  scrollToY(Math.max(0, window.scrollY + target.getBoundingClientRect().top - margin));
  const heading = target.matches("h1, h2, h3") ? target : (target.querySelector<HTMLElement>("h1, h2, h3") ?? target);
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
  window.history.replaceState(window.history.state, "", `#${target.id}`);
}

/** A click on an in-page link jumps, unless the reader asked for a new tab or window, or the target isn't on screen. */
export function jumpOnClick(event: MouseEvent<HTMLAnchorElement>, target: HTMLElement | null | undefined) {
  if (!target || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  jumpTo(target);
}
