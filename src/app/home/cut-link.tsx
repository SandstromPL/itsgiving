"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { cutClick, cutTo } from "../cut";

/**
 * A link to a finished treatment that opens it through the camera's window (cut.ts). A modified click (a new tab, a new
 * window) goes as a plain link does. The page is prefetched whole, so the board is ready under the cut.
 */
export function CutLink({ href, onClick, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      {...rest}
      href={href}
      prefetch
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !cutClick(event)) return;
        void cutTo(router, href);
      }}
    />
  );
}
