"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Board } from "@/app/studio/board";
import { useReceipts } from "@/app/studio/eggs";
import { handOff } from "@/app/studio/handoff";
import { StartYourOwn } from "@/app/studio/landing";
import { BackArrow } from "@/app/studio/icons";
import { ShareButton } from "@/app/studio/share";
import { Timeline, replaySteps } from "@/app/studio/timeline";
import type { Nudge } from "@/lib/agent/options";
import type { Treatment } from "@/lib/agent/types";
import { backButton, pillButton } from "@/app/studio/ui";

/**
 * A featured treatment's board, read-only: it was built when the site was deployed. A rework chip hands it to the
 * studio (handoff.tsx), which opens the same board at once and re-runs it there with the change. The way out is a link
 * to the examples, never history.back(): someone arriving from a shared link has no page of ours behind them.
 */
export function FeaturedBoard({ slug, treatment }: { slug: string; treatment: Treatment }) {
  const router = useRouter();
  useReceipts(treatment);
  useEffect(() => {
    router.prefetch("/studio");
  }, [router]);
  const rework = (nudge: Nudge) => {
    handOff(slug, nudge);
    router.push("/studio");
  };
  return (
    <div className="flex flex-col gap-8">
      <div className="-mb-2 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/examples" className={pillButton}>
          <BackArrow />
          All examples
        </Link>
        <ShareButton title={treatment.title} path={`/t/${slug}`} />
      </div>
      <Board
        treatment={treatment}
        state="current"
        nudges={[]}
        onToggleNudge={rework}
        running={false}
        take={1}
        log={<Timeline steps={replaySteps(treatment, "Built when the site was deployed: these are the calls that made it.", false)} />}
        back={
          <Link href="/examples" aria-label="All examples" title="All examples" className={backButton}>
            <BackArrow />
          </Link>
        }
        reworkNote="Built ahead of time. A change opens it in the studio, which re-runs the plan and the writing with it."
        own={false}
      />
      <StartYourOwn />
    </div>
  );
}
