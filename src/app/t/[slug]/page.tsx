import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { primaryButton } from "@/app/studio/landing";
import { ModeBadges } from "@/app/studio/parts";
import { HeaderLink, SiteHeader } from "@/app/studio/site-header";
import { EXAMPLES } from "@/lib/agent/examples";
import { featuredItem, featuredOffered } from "@/lib/agent/featured";
import { FeaturedBoard } from "./featured-board";

// A featured treatment as a page of its own: built with the site from the pre-built set, so it opens at once, and
// Back, reload and links behave as on any page. Static all the way down: nothing here may read the request, so the
// badges come from the treatment itself. An unknown slug is a real 404.

export const ensureStatic = "navigation";

/** From the examples, never the featured file: a build without keys has no file, and an empty list fails the build. */
export function generateStaticParams() {
  return EXAMPLES.filter((example) => example.featured).map((example) => ({ slug: example.slug }));
}

const lookup = (slug: string) => (featuredOffered() ? featuredItem(slug) : undefined);

export async function generateMetadata({ params }: PageProps<"/t/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const example = EXAMPLES.find((e) => e.featured && e.slug === slug);
  if (!example) return { title: "Page not found: itsgiving" };
  const item = lookup(slug);
  return item
    ? { title: `${item.treatment.title}: itsgiving`, description: item.treatment.logline }
    : { title: `${example.title}: itsgiving` };
}

export default async function FeaturedPage({ params }: PageProps<"/t/[slug]">) {
  const { slug } = await params;
  const example = EXAMPLES.find((e) => e.featured && e.slug === slug);
  if (!example) notFound();
  const item = lookup(slug);
  return (
    <>
      <SiteHeader
        links={
          <>
            <HeaderLink href="/#now-showing">All examples</HeaderLink>
            <HeaderLink href="/studio">Studio</HeaderLink>
            <HeaderLink href="/about">About</HeaderLink>
          </>
        }
        badges={item && <ModeBadges qloo="live" llm="live" treatment={item.treatment} />}
        unc
      />
      <main className="mx-auto flex w-full max-w-[80rem] flex-1 flex-col gap-8 px-4 pt-8 pb-16 sm:px-8 sm:pt-10 print:p-0">
        {item ? (
          <FeaturedBoard slug={slug} treatment={item.treatment} />
        ) : (
          // A server on mocks, or a build whose pre-built set doesn't match the examples any more.
          <div className="flex max-w-[42rem] flex-col items-start gap-5 rounded-[28px] border border-line bg-card p-8">
            <h1 className="type-head text-[clamp(2rem,3.4vw,2.75rem)] leading-tight">{example.title}</h1>
            <p className="text-[1.15rem] leading-[1.5] text-dim">
              This featured treatment is built from live Qloo data when the site is deployed, and this server doesn&apos;t have it. The
              studio can build the same brief: {example.detail.charAt(0).toLowerCase() + example.detail.slice(1)}
            </p>
            <Link href={`/studio?fill=${slug}`} className={primaryButton}>
              Open the brief in the studio
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
