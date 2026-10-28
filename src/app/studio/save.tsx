"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { Treatment } from "@/lib/agent/types";
import { SignInWindow, useAccount } from "./account";
import { handOffBoard } from "./handoff";
import { ShareWindow } from "./share";
import { CheckIcon } from "./icons";
import { outlineButton as outline } from "./ui";

// Save, on a board the studio built: it keeps the treatment in the director's account (its seal shows the server
// built it), then offers its share link. Signed out, Save opens the sign-in window; the board waits in the handoff
// and is saved when they come back.

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; id: string; shared: boolean } | { kind: "problem"; message: string };

const ink = "rounded-full bg-foreground px-4 py-2.5 text-[15px] font-bold text-background hover:opacity-90 disabled:opacity-60";

/** A saved treatment's link, for sharing: the same page its owner opens. */
export const savedUrl = (id: string) => `${window.location.origin}/s/${id}`;

export function SaveControl({ treatment, seal, autoSave = false }: { treatment: Treatment; seal: string; autoSave?: boolean }) {
  const account = useAccount();
  const id = useId();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const autoStarted = useRef(false);

  const save = async () => {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/saved", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ treatment, seal }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (res.ok && body.id) setStatus({ kind: "saved", id: body.id, shared: false });
      else setStatus({ kind: "problem", message: body.error ?? "Saving didn't work. Try again." });
    } catch {
      setStatus({ kind: "problem", message: "Saving didn't work: the connection dropped. Try again." });
    }
  };

  // Back from signing in to save this board: save it as soon as the session is known.
  useEffect(() => {
    if (!autoSave || autoStarted.current || account.state !== "in") return;
    autoStarted.current = true;
    void save();
  });

  // Share turns the link on the first time, then opens the share window (the link, the phone's share sheet, a QR code).
  const shareWindow = useRef<HTMLDivElement>(null);
  const shareButton = useRef<HTMLButtonElement>(null);
  const share = async (saved: Extract<Status, { kind: "saved" }>) => {
    if (!saved.shared) {
      const res = await fetch(`/api/saved/${saved.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shared: true }),
      }).catch(() => null);
      if (!res?.ok) {
        const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
        setStatus({ kind: "problem", message: body?.error ?? "The link couldn't be turned on. Try again." });
        return;
      }
    }
    setStatus({ ...saved, shared: true });
    // `source` makes the button the window's invoker where the browser supports it, so closing returns focus to it.
    (shareWindow.current?.showPopover as ((options?: { source?: HTMLElement }) => void) | undefined)?.call(shareWindow.current, {
      source: shareButton.current ?? undefined,
    });
  };

  if (account.state === "off" || account.state === "checking") return null;

  if (status.kind === "saved") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-1 text-[15px] font-bold">
          <CheckIcon size={16} />
          Saved
        </span>
        <button ref={shareButton} type="button" onClick={() => share(status)} className={outline}>
          {status.shared ? "Share" : "Share link"}
        </button>
        <Link
          href={`/s/${status.id}`}
          className="rounded-full px-2 py-2.5 text-[15px] font-semibold underline decoration-edge underline-offset-4 hover:decoration-foreground"
        >
          Open
        </Link>
        <span role="status" className="sr-only">
          {status.shared ? "Share link on." : "Saved to your treatments."}
        </span>
        <ShareWindow id={`${id}-share`} ref={shareWindow} title={treatment.title} path={`/s/${status.id}`} />
      </div>
    );
  }

  const signedIn = account.state === "in";
  return (
    <>
      <button
        type="button"
        onClick={signedIn ? save : undefined}
        popoverTarget={signedIn ? undefined : `${id}-in`}
        disabled={status.kind === "saving"}
        className={ink}
      >
        {status.kind === "saving" ? "Saving…" : "Save"}
      </button>
      {status.kind === "problem" && (
        <span role="alert" className="text-[14px] font-semibold text-safelight">
          {status.message}
        </span>
      )}
      {!signedIn && (
        <SignInWindow id={`${id}-in`} title="Sign in to save" next="/studio" before={() => handOffBoard({ treatment, seal, save: true })} />
      )}
    </>
  );
}
