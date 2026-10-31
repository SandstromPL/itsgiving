"use client";

import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { ROOM_KEY } from "./theme-script";

export type RoomId = "grade" | "tungsten" | "trix" | "light";

/** The four rooms, each with the three colours its dots show: the room, its ink and its evidence. */
export const ROOMS: { id: RoomId; name: string; note: string; dots: [string, string, string] }[] = [
  { id: "grade", name: "Grade", note: "Neutral grey, so stills read true. The default.", dots: ["#141414", "#ededed", "#e4ff3a"] },
  { id: "tungsten", name: "Tungsten", note: "Warm and lamp-lit, with amber evidence.", dots: ["#16110c", "#f4e9d9", "#ffbf7a"] },
  { id: "trix", name: "Tri-X", note: "Black and white; only the films keep colour.", dots: ["#101010", "#f2f2f2", "#ffffff"] },
  { id: "light", name: "Light", note: "The paper room.", dots: ["#f2f0ea", "#121211", "#e4ff3a"] },
];

const isRoom = (value: unknown): value is RoomId => ROOMS.some((r) => r.id === value);

/**
 * The room, kept where the stylesheet reads it: `data-room` on <html> (none for grade), with `data-theme` saying light
 * or dark for the rules that only care which. Storage can be missing or blocked; then the choice lasts for the visit.
 */
const room = {
  listeners: new Set<() => void>(),
  read(): RoomId {
    const id = document.documentElement.dataset.room;
    return isRoom(id) ? id : "grade";
  },
  write(id: RoomId) {
    const html = document.documentElement;
    if (id === "grade") delete html.dataset.room;
    else html.dataset.room = id;
    html.dataset.theme = id === "light" ? "light" : "dark";
    try {
      if (id === "grade") localStorage.removeItem(ROOM_KEY);
      else localStorage.setItem(ROOM_KEY, id);
    } catch {
      // kept for this visit only
    }
    room.listeners.forEach((listener) => listener());
  },
  subscribe(listener: () => void) {
    room.listeners.add(listener);
    return () => room.listeners.delete(listener);
  },
};

/**
 * Switches the room with a quick crossfade of the whole page, where the browser has view transitions: a fade, so
 * reduced motion keeps it. The picker re-renders inside the transition (flushSync), so the picture it fades to has the
 * new room checked.
 */
function choose(id: RoomId) {
  if (id === room.read()) return;
  if (!document.startViewTransition) return room.write(id);
  document.startViewTransition(() => flushSync(() => room.write(id))).ready.catch(() => {});
}

/** The room the page is in, for code that draws with its colours (the camera cut reads the tokens instead). */
export function useRoom(): RoomId {
  return useSyncExternalStore(room.subscribe, room.read, () => "grade" as const);
}

/** The rooms as a radio group, for the profile menu. */
export function RoomPicker({ name }: { name: string }) {
  const current = useRoom();
  return (
    <fieldset className="border-y border-line px-1.5 pt-3 pb-1.5">
      <legend className="px-1.5 text-small font-bold text-dim">Room</legend>
      {ROOMS.map((r) => (
        <label
          key={r.id}
          className="room-option grid min-h-13 cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-background"
        >
          <input type="radio" name={name} value={r.id} checked={current === r.id} onChange={() => choose(r.id)} className="peer sr-only" />
          <span aria-hidden className="inline-flex">
            {r.dots.map((c, i) => (
              <i key={c} className={`size-4 rounded-full ring-2 ring-field ${i ? "-ml-1.5" : ""}`} style={{ background: c }} />
            ))}
          </span>
          <span>
            <b className="block text-ui">{r.name}</b>
            <small className="block text-caption leading-tight text-faint">{r.note}</small>
          </span>
          <span
            aria-hidden
            className="grid size-5 place-items-center rounded-full border-[1.5px] border-edge peer-checked:border-foreground peer-checked:bg-foreground peer-checked:after:size-2 peer-checked:after:rounded-full peer-checked:after:bg-background peer-checked:after:content-[''] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground"
          />
        </label>
      ))}
    </fieldset>
  );
}
