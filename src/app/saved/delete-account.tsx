"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The foot of the saved list: delete the account and everything saved with it. The server deletes and signs this
// browser out; the list then shows itself signed out, saying it's done.

const loadClient = () => import("@/lib/supabase/browser");

export function DeleteAccount({ saved }: { saved: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async () => {
    const question =
      saved > 0
        ? `Delete your itsgiving account and its ${saved === 1 ? "saved treatment" : `${saved} saved treatments`}? Their share links stop working too. This can't be undone.`
        : "Delete your itsgiving account? This can't be undone.";
    if (!window.confirm(question)) return;
    setBusy(true);
    setProblem(null);
    const res = await fetch("/api/account", { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      // The server cleared the session cookies; the browser's client forgets its own copy, which also turns the
      // header's account button back to Sign in.
      await (await loadClient()).signOut().catch(() => undefined);
      router.push("/saved?account=deleted");
      router.refresh();
      return;
    }
    setBusy(false);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setProblem(body?.error ?? "Your account couldn't be deleted. Try again.");
  };

  return (
    <section
      aria-labelledby="delete-account"
      className="flex max-w-[42rem] flex-col items-start gap-3 border-t border-line pt-8 print:hidden"
    >
      <h2 id="delete-account" className="type-head text-title leading-tight">
        Delete your account
      </h2>
      <p className="text-ui leading-6 text-dim">
        This deletes your itsgiving account and every treatment you&apos;ve saved, and their share links stop working. Your Google or GitHub
        account isn&apos;t touched; signing in again starts a new, empty account.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={remove}
        className="min-h-11 rounded-full border border-safelight px-4 py-2 text-ui font-semibold text-safelight hover:bg-safelight hover:text-background disabled:opacity-60"
      >
        {busy ? "Deleting…" : "Delete my account"}
      </button>
      {problem && (
        <p role="alert" className="text-ui font-semibold text-safelight">
          {problem}
        </p>
      )}
    </section>
  );
}
