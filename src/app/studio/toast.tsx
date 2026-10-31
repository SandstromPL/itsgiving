import { useEffect, useState } from "react";

export interface ToastNote {
  title: string;
  line: string;
  open: boolean;
}

/** How long the toast stays, counted only while the tab is in view. */
const TOAST_MS = 6000;

/**
 * The toast's note and its timer. The time runs only while the tab is in view: a director who looked away during the
 * run (the tab's title says "Ready:") still sees it on coming back.
 */
export function useToast() {
  const [toast, setToast] = useState<ToastNote | null>(null);
  useEffect(() => {
    if (!toast?.open) return;
    let left = TOAST_MS;
    let since = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      since = Date.now();
      timer = setTimeout(() => setToast((note) => note && { ...note, open: false }), left);
    };
    const onVisibility = () => {
      if (!document.hidden) return run();
      clearTimeout(timer);
      left -= Date.now() - since;
    };
    if (!document.hidden) run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [toast]);
  return [toast, setToast] as const;
}

/**
 * A fresh treatment lands with a short toast; the live region already announced it, so this is for the eyes. It's
 * always there, closed until a treatment lands: a moment after the board it drops in at the top, under the header, clear
 * of the board's own buttons (Save, Save as PDF), fades back out keeping its words, and lets taps through.
 */
export function Toast({ toast }: { toast: ToastNote | null }) {
  return (
    <div
      aria-hidden
      data-open={toast?.open || undefined}
      className="pointer-events-none fixed top-[calc(var(--head,0px)+14px)] left-1/2 z-40 flex w-max max-w-[min(25rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-3 items-center gap-3.5 rounded-[20px] bg-foreground px-4 py-3.5 text-background opacity-0 shadow-[0_14px_36px_rgb(0_0_0/0.38)] transition-[opacity,translate] duration-200 motion-reduce:translate-y-0 data-open:translate-y-0 data-open:opacity-100 data-open:delay-400 data-open:duration-300 print:hidden"
    >
      {toast && (
        <>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-background text-foreground">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12l5 5 9-10" />
            </svg>
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-lead leading-tight font-extrabold tracking-[-0.03em]">{toast.title}</span>
            <span className="truncate text-small opacity-80">{toast.line}</span>
          </span>
        </>
      )}
    </div>
  );
}
