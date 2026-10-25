import { Suspense } from "react";
import { LiveModes } from "./studio/live-modes";
import { ModesPending } from "./studio/parts";
import { Studio } from "./studio/studio";

export default function Home() {
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
