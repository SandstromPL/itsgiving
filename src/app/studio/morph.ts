// The match cut from a homepage poster to its example's cover: the poster's still grows into the cover's still as the
// page changes. One view transition the poster starts by hand, forward only. React's <ViewTransition> isn't used:
// any of them in a page makes React run that page's Back through a view transition too, which moves the page swap out
// of the popstate task the browser restores scroll in. Here Back stays exactly as it was.

const NAME = "cover-still";

/** The cover the poster is opening, until it has landed (or a second has passed). */
let arrival: { slug: string; named: boolean; land: (named: HTMLElement[]) => void } | null = null;

/**
 * A poster's `onNavigate`: instead of navigating plainly, names the poster's still and navigates inside a view
 * transition that ends when the example's cover has landed (`landCover`). Reduced motion keeps the page's
 * crossfade and leaves the still unnamed, so nothing moves. Browsers without view transitions navigate as usual.
 */
export function morphToCover(event: { preventDefault(): void }, slug: string, still: HTMLElement | null, go: () => void): void {
  if (!still || typeof document.startViewTransition !== "function") return;
  event.preventDefault();
  const named = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (named) still.style.viewTransitionName = NAME;
  let landed: HTMLElement[] = [];
  let over = false;
  const unname = (parts: HTMLElement[]) => parts.forEach((part) => (part.style.viewTransitionName = ""));
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(cap);
          arrival = null;
          resolve();
        };
        // A slow page never holds the tap for long: after a second the transition plays to whatever is there.
        const cap = setTimeout(finish, 1000);
        arrival = {
          slug,
          named,
          land: (parts) => {
            landed = parts;
            // Landing after the second ran out: the transition is over, so the names go at once.
            if (over) unname(parts);
            finish();
          },
        };
        go();
      }),
  );
  transition.ready.catch(() => {});
  void transition.finished.finally(() => {
    over = true;
    unname([still, ...landed]);
  });
}

/**
 * The example cover's side, from its layout effect: when it is the cover a poster is opening, it takes the still's
 * name, skips its letterbox (the match cut is its arrival; two motions would be one too many) and, once its still has
 * an image to show (at most 300 ms more), lets the transition play. The cover's words and top row (`data-morph`) get
 * names of their own, so they come in over the growing still rather than under it.
 */
export function landCover(slug: string, frame: HTMLElement | null, still: HTMLElement | null): void {
  const coming = arrival;
  if (!coming || coming.slug !== slug) return;
  arrival = null;
  const named: HTMLElement[] = [];
  if (coming.named && still) {
    still.style.viewTransitionName = NAME;
    named.push(still);
    for (const part of frame?.querySelectorAll<HTMLElement>("[data-morph]") ?? []) {
      part.style.viewTransitionName = `cover-${part.dataset.morph}`;
      named.push(part);
    }
  }
  for (const animation of frame?.getAnimations() ?? []) animation.finish();
  const img = still?.querySelector("img");
  const ready = img && !img.complete ? Promise.race([img.decode().catch(() => undefined), new Promise((r) => setTimeout(r, 300))]) : null;
  // After this commit's layout effects, Next's scroll to the top among them, so the new picture is the page at its top.
  void (ready ?? Promise.resolve()).then(() => setTimeout(() => coming.land(named), 0));
}
