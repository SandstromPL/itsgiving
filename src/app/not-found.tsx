import type { Metadata } from "next";
import { NotFoundBody } from "./studio/not-found-body";
import { SiteHeader } from "./studio/site-header";

export const metadata: Metadata = { title: "Page not found: itsgiving" };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col justify-center gap-6 px-4 py-24 sm:px-8">
        <NotFoundBody />
      </main>
    </>
  );
}
