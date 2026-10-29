"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { SignInButton, useAccount } from "./account";
import { pillButton, primaryButton } from "./ui";
import { useLingo } from "./lingo";

/** Whether this 404 answers a saved treatment's link: the proxy sends one that leads nowhere here, keeping its address. */
const onSavedLink = () => window.location.pathname.startsWith("/s/");
const unchanging = () => () => {};

/**
 * The 404's words, in the reader's register: unc mode gets a plain heading. On a saved treatment's link, a signed-out
 * visitor is offered the way in, since a private one opens only for its owner. That part comes once the page is live:
 * the page is built once for every missing address, and whether anyone is signed in is the browser's to say.
 */
export function NotFoundBody() {
  const { t } = useLingo();
  const savedLink = useSyncExternalStore(unchanging, onSavedLink, () => false);
  const account = useAccount();
  const offerSignIn = savedLink && account.state === "out";
  return (
    <>
      <h1 className="type-poster max-w-[14ch] text-display-lg">{t.notFound.title}</h1>
      <p className="max-w-[44ch] text-prose leading-[1.45] text-dim">
        {t.notFound.line}
        {offerSignIn && " If it's a saved treatment of yours, sign in to open it."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {offerSignIn && <SignInButton className={primaryButton} />}
        <Link href="/" className={offerSignIn ? `${pillButton} min-h-14 px-7 text-body` : primaryButton}>
          Back to the homepage
        </Link>
      </div>
    </>
  );
}
