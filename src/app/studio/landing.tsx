import Link from "next/link";
import { primaryButton } from "./ui";

// What the homepage left behind when it moved to src/app/home/: the closing call that the featured and saved boards and
// About still end on.

/** The closing call, for whoever read this far: at the end of a featured or saved treatment and of About. */
export function StartYourOwn() {
  return (
    <section
      aria-labelledby="start-heading"
      className="flex flex-col items-start gap-6 rounded-[2rem] border border-line bg-card p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10 print:hidden"
    >
      <div className="flex flex-col gap-2">
        <h2 id="start-heading" className="type-head text-section leading-tight">
          Make one for your next video or short.
        </h2>
        <p className="text-lead text-dim">An artist or a film, and a city, are enough to start.</p>
      </div>
      <Link href="/studio" className={primaryButton}>
        Start a treatment
      </Link>
    </section>
  );
}
