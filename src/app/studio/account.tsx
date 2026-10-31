"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { accountsOn } from "@/lib/supabase/config";
import type { Provider } from "@/lib/supabase/browser";
import { RoomPicker } from "./theme";

// Accounts in the browser: who's signed in, the header's account button, and the sign-in window that Save opens too.
// The session is read here, never on the server, so the pages that must stay static (the homepage, a featured
// treatment) don't read cookies. Supabase's client loads only once an account control is on screen. Without
// Supabase's keys (mock mode, a fresh clone) everything here renders nothing.

export type Account = { state: "off" } | { state: "checking" } | { state: "out" } | { state: "in"; name: string; email?: string };

const loadClient = () => import("@/lib/supabase/browser");

/** Who's signed in, kept current as they sign in or out in this tab or another. */
export function useAccount(): Account {
  const [account, setAccount] = useState<Account>(accountsOn ? { state: "checking" } : { state: "off" });
  useEffect(() => {
    if (!accountsOn) return;
    let live = true;
    let stop = () => {};
    void loadClient().then(({ browserSupabase }) => {
      const supabase = browserSupabase();
      if (!supabase || !live) return;
      const show = (user: { email?: string; user_metadata?: Record<string, unknown> } | null | undefined) => {
        if (!live) return;
        if (!user) return setAccount({ state: "out" });
        const meta = user.user_metadata ?? {};
        const named = [meta.full_name, meta.name, meta.user_name].find((v): v is string => typeof v === "string" && v.trim() !== "");
        setAccount({ state: "in", name: named ?? user.email ?? "You", email: user.email });
      };
      void supabase.auth.getSession().then(({ data }) => show(data.session?.user));
      const { data } = supabase.auth.onAuthStateChange((_event, session) => show(session?.user));
      stop = () => data.subscription.unsubscribe();
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return account;
}

function GoogleMark() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 48 48">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * The sign-in window: Google or GitHub, through Supabase, and back to `next` (where they were, unless said). `before`
 * runs first, while the page is still here: Save leaves its board for the studio to finish saving on return.
 */
export function SignInWindow({ id, title = "Sign in", next, before }: { id: string; title?: string; next?: string; before?: () => void }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const go = async (provider: Provider) => {
    setBusy(provider);
    setProblem(null);
    before?.();
    const { signIn } = await loadClient();
    const failed = await signIn(provider, next ?? `${window.location.pathname}${window.location.search}`);
    // On success the page is already leaving for Google or GitHub.
    if (failed) {
      setBusy(null);
      setProblem(failed);
    }
  };
  const provider = "flex min-h-13 items-center justify-center gap-3 rounded-full border-2 border-ink px-5 text-body font-bold";
  return (
    <div id={id} popover="auto" className="dialog" role="dialog" aria-labelledby={`${id}-title`}>
      <div className="flex flex-col gap-4 p-6">
        <h2 id={`${id}-title`} className="type-head text-heading leading-none">
          {title}
        </h2>
        <p className="text-ui leading-6 text-dim">
          Building a treatment needs no account. Signed in, you can keep the ones you make and share them by link.
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => go("google")}
            disabled={busy !== null}
            className={`${provider} bg-white text-ink hover:bg-field`}
          >
            <GoogleMark />
            {busy === "google" ? "Opening Google…" : "Continue with Google"}
          </button>
          <button
            type="button"
            onClick={() => go("github")}
            disabled={busy !== null}
            className={`${provider} bg-ink text-white hover:opacity-90`}
          >
            <GitHubMark />
            {busy === "github" ? "Opening GitHub…" : "Continue with GitHub"}
          </button>
        </div>
        {problem && (
          <p role="alert" className="text-ui font-semibold text-safelight">
            {problem}
          </p>
        )}
        <p className="text-caption leading-5 text-faint">
          itsgiving keeps your name and email from Google or GitHub, and the treatments you save. None of it goes to Qloo or the AI models,
          and you can delete it all from Your treatments.
        </p>
        <button
          type="button"
          popoverTarget={id}
          popoverTargetAction="hide"
          className="self-start rounded-full px-1 py-2 text-ui font-semibold underline decoration-edge underline-offset-4 hover:decoration-ink"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/** A "Sign in" button with its window, for a page that asks for it in place (the saved list, a private treatment). */
export function SignInButton({ next, className }: { next?: string; className: string }) {
  const id = useId();
  return (
    <>
      <button type="button" popoverTarget={`${id}-in`} className={className}>
        Sign in
      </button>
      <SignInWindow id={`${id}-in`} next={next} />
    </>
  );
}

/**
 * The header's profile menu: the person's initial when they're signed in, else a person glyph. It opens on the room
 * picker (four rooms, for everyone), with Sign in, or their treatments and Sign out, above it when accounts are on.
 */
export function AccountButton({ className = "" }: { className?: string }) {
  const account = useAccount();
  const router = useRouter();
  const id = useId();
  const menu = `${id}-menu`;
  const signedIn = account.state === "in";
  const initial = signedIn ? account.name.trim().charAt(0).toUpperCase() || "?" : "";
  return (
    <>
      <button
        type="button"
        popoverTarget={menu}
        aria-label={signedIn ? `Account and room: ${account.name}` : "Room and sign in"}
        title={signedIn ? account.name : "Room"}
        className={`press grid size-11 place-items-center rounded-full border border-foreground sm:size-12 ${
          signedIn ? "bg-foreground text-body font-extrabold text-background" : "bg-card text-foreground hover:bg-field"
        } ${className}`}
      >
        {signedIn ? (
          initial
        ) : (
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <div id={menu} popover="auto" className="menu" aria-label={signedIn ? "Account and room" : "Room"}>
        <div className="flex flex-col gap-1 p-2">
          {signedIn && (
            <>
              <p className="truncate px-3 pt-2 pb-1 text-caption text-faint">{account.email ?? account.name}</p>
              <MenuLink href="/saved" menu={menu}>
                Your treatments
              </MenuLink>
            </>
          )}
          {account.state === "out" && (
            <button
              type="button"
              popoverTarget={`${id}-in`}
              className="rounded-xl px-3 py-2.5 text-left text-ui font-semibold hover:bg-background"
            >
              Sign in
            </button>
          )}
          <RoomPicker name={`${id}-room`} />
          {signedIn && (
            <button
              type="button"
              onClick={async () => {
                const { signOut } = await loadClient();
                await signOut();
                document.getElementById(menu)?.hidePopover();
                router.refresh();
              }}
              className="rounded-xl px-3 py-2.5 text-left text-ui font-semibold hover:bg-background"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
      {account.state === "out" && <SignInWindow id={`${id}-in`} />}
    </>
  );
}

function MenuLink({ href, menu, children }: { href: string; menu: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      onClick={() => document.getElementById(menu)?.hidePopover()}
      className="rounded-xl px-3 py-2.5 text-ui font-semibold hover:bg-background"
    >
      {children}
    </Link>
  );
}
