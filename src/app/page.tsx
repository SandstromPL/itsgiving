import { Suspense } from "react";
import { featuredCovers } from "@/lib/agent/featured";
import { llmConfigFromEnv } from "@/lib/llm/config";
import { qlooConfigFromEnv } from "@/lib/qloo";
import { LiveModes } from "./studio/live-modes";
import { ModesPending } from "./studio/parts";
import { Studio } from "./studio/studio";

export default function Home() {
  // Featured treatments are live data, so a server running on mocks doesn't offer them: their covers
  // would promise what a mock run can't deliver. Read at build time, they become part of the static shell.
  const live = qlooConfigFromEnv().mode === "live" && llmConfigFromEnv().mode === "live";
  return (
    <Studio
      featured={live ? featuredCovers() : []}
      initialBadges={
        <Suspense fallback={<ModesPending />}>
          <LiveModes />
        </Suspense>
      }
    />
  );
}
