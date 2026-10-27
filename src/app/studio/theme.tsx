"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { THEME_KEY } from "./theme-script";

export type ThemeChoice = "light" | "dark";

/**
 * The room's theme, kept where the stylesheet reads it: `data-theme` on <html>. Light unless the visitor picked dark;
 * the device's setting doesn't decide it. Storage can be missing or blocked; then the choice lasts for the visit.
 */
const theme = {
  listeners: new Set<() => void>(),
  read(): ThemeChoice {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  },
  write(choice: ThemeChoice) {
    document.documentElement.dataset.theme = choice;
    try {
      localStorage.setItem(THEME_KEY, choice);
    } catch {
      // kept for this visit only
    }
    theme.listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    theme.listeners.add(listener);
    return () => theme.listeners.delete(listener);
  },
};

/**
 * Switches the room with a quick crossfade of the whole page, where the browser has view transitions: a fade, so
 * reduced motion keeps it. The switch re-renders inside the transition (flushSync), so the picture it fades to has the
 * new choice pressed.
 */
function choose(choice: ThemeChoice) {
  if (choice === theme.read()) return;
  if (!document.startViewTransition) return theme.write(choice);
  document.startViewTransition(() => flushSync(() => theme.write(choice))).ready.catch(() => {});
}

const icon = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const OPTIONS: { id: ThemeChoice; label: string; glyph: ReactNode }[] = [
  {
    id: "light",
    label: "Light",
    glyph: (
      <svg aria-hidden {...icon}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    id: "dark",
    label: "Dark",
    glyph: (
      <svg aria-hidden {...icon}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
];

/** Light or dark: two icon buttons, the chosen one inked in. */
export function ThemeSwitch() {
  // The server renders the default; the browser reads a saved choice once hydrated.
  const choice = useSyncExternalStore(theme.subscribe, theme.read, () => "light" as const);
  return (
    <div role="group" aria-label="Theme" className="flex gap-0.5 rounded-full border border-foreground bg-card p-[3px] print:hidden">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-label={option.label}
          aria-pressed={choice === option.id}
          title={option.label}
          onClick={() => choose(option.id)}
          className="grid size-10 place-items-center rounded-full text-foreground hover:bg-field aria-pressed:bg-foreground aria-pressed:text-background"
        >
          {option.glyph}
        </button>
      ))}
    </div>
  );
}
