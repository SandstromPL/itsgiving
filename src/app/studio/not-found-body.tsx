"use client";

import Link from "next/link";
import { primaryButton } from "./ui";
import { useLingo } from "./lingo";

/** The 404's words, in the reader's register: unc mode gets a plain heading. */
export function NotFoundBody() {
  const { t } = useLingo();
  return (
    <>
      <span className="-rotate-3 self-start rounded-xl bg-accent px-3.5 py-2 text-[15px] font-bold text-[#121211]">404</span>
      <h1 className="type-poster max-w-[14ch] text-[clamp(3.5rem,8vw,7rem)]">{t.notFound.title}</h1>
      <p className="max-w-[44ch] text-[1.2rem] leading-[1.45] text-dim">{t.notFound.line}</p>
      <Link href="/" className={`${primaryButton} self-start`}>
        Back to the homepage
      </Link>
    </>
  );
}
