import { useState, type AnimationEvent } from "react";

/**
 * A cover's letterbox (globals.css), opened once per take. Next only hides a page you leave, and showing it again on
 * Back or Forward restarts its CSS animations, so the class comes off once the opening has run. `take` names the cover
 * on screen: a new take in the studio opens again.
 */
export function useLetterbox(take = "") {
  const [opened, setOpened] = useState<string | null>(null);
  return {
    className: opened === take ? "" : "letterbox-open",
    onAnimationEnd: (event: AnimationEvent) => {
      if (event.target === event.currentTarget && event.animationName === "letterbox-open") setOpened(take);
    },
  };
}
