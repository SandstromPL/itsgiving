import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveModes } from "./live-modes";
import { ModesPending } from "./parts";
import { Studio } from "./studio";

export const metadata: Metadata = { title: "Studio: itsgiving" };

/** The tool: the brief, the run, and the board it builds. The badges are read per request; the rest is static. */
export default function StudioPage() {
  return (
    <Studio
      initialBadges={
        <Suspense fallback={<ModesPending />}>
          <LiveModes />
        </Suspense>
      }
    />
  );
}
