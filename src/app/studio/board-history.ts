import { useEffect, useRef, useState } from "react";

/**
 * A board gets its own history entry (same URL, this marker in its state), so the browser's Back button returns
 * to the brief and Forward reopens the board. Next.js keeps its own fields alongside it.
 */
const BOARD_ENTRY = "board";
export const onBoardEntry = () => window.history.state?.itsgiving === BOARD_ENTRY;

/**
 * The history entry the page is on, by its Navigation API key, or null where the browser has no Navigation API.
 * Coming back to the entry the studio was left on means Back or Forward; a link to the studio makes a new one.
 */
const entryKey = () =>
  (window as Window & { navigation?: { currentEntry?: { key: string } | null } }).navigation?.currentEntry?.key ?? null;

export type StudioView = "studio" | "board";

/**
 * The studio's brief and board as history: Back and Forward move between them, each kept where the director left it.
 * `showBoard("new")` gives a board an entry of its own; `showBoard("unless-there")` keeps the one a rework's board
 * replaces in place. `leaveBoard` goes back to the brief.
 */
export function useBoardHistory() {
  const [view, setView] = useState<StudioView>("studio");
  /** Where they were on the board when they stepped out, for Forward; null when the board should open at its top. */
  const boardSpot = useRef<number | null>(null);
  /** Set when the director steps back out of a board, so the brief can focus the way back in. */
  const leftBoard = useRef(false);
  const viewNow = useRef(view);
  /** Where the page is, and in which history entry: kept when the director leaves for another page. */
  const spot = useRef<{ y: number; key: string | null }>({ y: 0, key: null });
  const leftAt = useRef<{ y: number; key: string | null } | null>(null);

  // The page puts each view back itself: the browser's own restoring would land after it, at wherever the entry was
  // first written. Only on this page's entries: the homepage and featured pages keep the browser's own.
  useEffect(() => {
    window.history.scrollRestoration = "manual";
    // Back or Forward from another page lands on this page's entry, which the browser won't restore: this does. The
    // traversal's own events can't say so, since Next has shown the page again before they fire.
    const left = leftAt.current;
    if (left?.key && left.key === entryKey()) window.scrollTo({ top: left.y });
    spot.current = { y: window.scrollY, key: entryKey() };
    // Only this page's own scrolling: leaving for "/#now-showing" scrolls the next page before this page lets go.
    const onScroll = () => {
      if (window.location.pathname === "/studio") spot.current = { y: window.scrollY, key: entryKey() };
    };
    const onPop = (event: PopStateEvent) => {
      // An entry with no state comes from a plain "#id" jump (the address bar, say): a place on this view, not a move
      // between the brief and the board.
      if (event.state === null) return;
      const next = onBoardEntry() ? "board" : "studio";
      if (next === viewNow.current) return;
      if (next === "studio") {
        boardSpot.current = window.scrollY;
        leftBoard.current = true;
      }
      setView(next);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPop);
      leftAt.current = spot.current;
      // The mode is kept per history entry, and this runs once the next page's entry is current: that page keeps the
      // browser's own restoring. (Putting back the mode found on arrival leaked "manual": arriving by Back, the
      // studio's entry still holds it.)
      window.history.scrollRestoration = "auto";
    };
  }, []);

  useEffect(() => {
    viewNow.current = view;
    if (view === "board") {
      if (boardSpot.current !== null) window.scrollTo({ top: boardSpot.current });
      boardSpot.current = null;
    } else if (leftBoard.current) {
      // Back at the brief from a board: the top of the page, with focus on the way back in.
      leftBoard.current = false;
      window.scrollTo({ top: 0 });
      document.getElementById("reopen-board")?.focus({ preventScroll: true });
    }
    // A board or the brief can be a new history entry without any scrolling to note it.
    spot.current = { y: window.scrollY, key: entryKey() };
  }, [view]);

  const showBoard = (entry: "new" | "unless-there") => {
    if (entry === "new" || !onBoardEntry()) {
      boardSpot.current = null;
      window.history.pushState({ itsgiving: BOARD_ENTRY }, "");
    }
    setView("board");
  };

  /** Back to the brief, through the browser's history when the board has its entry, so Back and Forward agree. */
  const leaveBoard = () => {
    if (onBoardEntry()) {
      window.history.back();
    } else {
      boardSpot.current = window.scrollY;
      leftBoard.current = true;
      setView("studio");
    }
  };

  return { view, showBoard, leaveBoard };
}
