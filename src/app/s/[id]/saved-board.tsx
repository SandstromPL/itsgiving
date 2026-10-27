"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignInButton, useAccount } from "@/app/studio/account";
import { Board } from "@/app/studio/board";
import { handOffBoard } from "@/app/studio/handoff";
import { StartYourOwn, primaryButton } from "@/app/studio/landing";
import { BackArrow } from "@/app/studio/parts";
import { copyText } from "@/app/studio/clipboard";
import { savedUrl } from "@/app/studio/save";
import { ShareButton } from "@/app/studio/share";
import { Timeline, replaySteps } from "@/app/studio/timeline";
import type { Nudge } from "@/lib/agent/options";
import type { Treatment } from "@/lib/agent/types";

// A saved treatment's page, as its owner sees it (share link on or off, copy, delete) or as anyone with the link sees
// it while it's shared (read-only, like an example). Either way a rework chip takes the board to the studio, which
// re-runs it there as a new take: the owner's next version, or the reader's own, to save for themselves.

const pill = "flex min-h-11 items-center gap-2 rounded-full border border-foreground py-2 pr-5 pl-4 text-[15px] font-bold hover:bg-card";
const outline = "rounded-full border border-foreground px-4 py-2.5 text-[15px] font-semibold hover:bg-foreground hover:text-background";

export function SavedBoard({ id, treatment, own, shared }: { id: string; treatment: Treatment; own: boolean; shared: boolean }) {
  const router = useRouter();
  const rework = (nudge: Nudge) => {
    handOffBoard({ treatment, nudge });
    router.push("/studio");
  };
  return (
    <div className="flex flex-col gap-8">
      {own ? (
        <OwnerBar id={id} shared={shared} title={treatment.title} />
      ) : (
        // A shared page carries words someone else chose (their brief, and the writing it steered), on this site: say
        // so before anything else, so it isn't read as itsgiving's own.
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="rounded-2xl border border-line bg-card px-4 py-2.5 text-[14px] leading-5 text-dim">
            Shared by an itsgiving user: their brief, Qloo&apos;s data and AI-written text, not checked by itsgiving.
          </p>
          <ShareButton title={treatment.title} path={`/s/${id}`} />
        </div>
      )}
      <Board
        treatment={treatment}
        state="current"
        nudges={[]}
        onToggleNudge={rework}
        running={false}
        take={1}
        log={<Timeline steps={replaySteps(treatment, "Saved from the studio: these are the calls that made it.", own)} />}
        back={
          <Link
            href={own ? "/saved" : "/"}
            aria-label={own ? "Your treatments" : "Home"}
            title={own ? "Your treatments" : "Home"}
            className="-ml-1.5 grid size-10 shrink-0 place-items-center rounded-full hover:bg-card"
          >
            <BackArrow />
          </Link>
        }
        reworkNote={
          own
            ? "A change opens it in the studio and re-runs the plan and the writing as a new take."
            : "A change opens it in the studio as your own take, which you can save."
        }
        own={own}
      />
      {!own && <StartYourOwn />}
    </div>
  );
}

/** The owner's controls above their board: back to the list, the share link, and delete. */
function OwnerBar({ id, shared: sharedAtFirst, title }: { id: string; shared: boolean; title: string }) {
  const router = useRouter();
  const [shared, setShared] = useState(sharedAtFirst);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; alert?: boolean } | null>(null);

  const setSharing = async (on: boolean) => {
    setBusy(true);
    setNote(null);
    const res = await fetch(`/api/saved/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shared: on }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
      return setNote({ text: body?.error ?? "That didn't work. Try again.", alert: true });
    }
    setShared(on);
    if (!on) return setNote({ text: "Link off. Only you can open this treatment now; turned on again, it's the same link." });
    const copied = await copyText(savedUrl(id));
    setNote({
      text: copied ? "Link on, and copied: anyone with it can read this treatment." : "Link on: anyone with it can read this treatment.",
    });
  };

  const remove = async () => {
    if (!window.confirm("Delete this treatment? Its share link stops working too.")) return;
    setBusy(true);
    const res = await fetch(`/api/saved/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      router.push("/saved");
      router.refresh();
      return;
    }
    setBusy(false);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setNote({ text: body?.error ?? "It couldn't be deleted. Try again.", alert: true });
  };

  return (
    <div className="flex flex-col gap-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2.5">
        <Link href="/saved" className={`${pill} -mb-0.5`}>
          <BackArrow />
          Your treatments
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            aria-pressed={shared}
            disabled={busy}
            onClick={() => setSharing(!shared)}
            className={`${outline} aria-pressed:bg-foreground aria-pressed:text-background`}
          >
            {shared ? "Share link: on" : "Share link: off"}
          </button>
          {shared && <ShareButton title={title} path={`/s/${id}`} />}
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="rounded-full px-3 py-2.5 text-[15px] font-semibold text-safelight underline underline-offset-4"
          >
            Delete
          </button>
        </div>
      </div>
      {note && (
        <p
          role={note.alert ? "alert" : "status"}
          className={`text-[15px] ${note.alert ? "font-semibold text-safelight" : "text-dim"} break-words`}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

/**
 * A saved treatment this visitor can't open: it's private, it's gone, or the link is wrong. The answer is the same for
 * all three, so it never says whether a treatment exists; a signed-out owner is offered the way in.
 */
export function SavedMissing() {
  const account = useAccount();
  return (
    <>
      <span className="-rotate-3 self-start rounded-xl bg-accent px-3.5 py-2 text-[15px] font-bold text-[#121211]">404</span>
      <h1 className="type-poster max-w-[14ch] text-[clamp(3rem,7vw,6rem)]">nothing to show here</h1>
      <p className="max-w-[46ch] text-[1.2rem] leading-[1.45] text-dim">
        This treatment is private, deleted, or its link is wrong.{account.state === "out" && " If it's yours, sign in to open it."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {account.state === "out" && <SignInButton className={primaryButton} />}
        <Link href="/" className={`${pill} min-h-14 px-7 text-[17px]`}>
          Back to the homepage
        </Link>
      </div>
    </>
  );
}
