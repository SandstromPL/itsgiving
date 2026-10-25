/**
 * Pre-builds the featured examples (src/lib/agent/examples.ts) so they open instantly and never depend
 * on live rate limits while someone is looking.
 *
 *   npm run featured                    rebuild every featured example (live Qloo and models)
 *   npm run featured -- --only=<slug>   rebuild one and keep the others
 *   npm run featured -- --if-missing    do nothing when a set already exists (the prebuild step)
 *
 * Writes .cache/featured/featured.json. That folder is gitignored because Qloo data must never be
 * committed, so each deploy builds its own set in the prebuild step. A failed rebuild keeps the
 * previous treatment for that example, and the prebuild never fails the build.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { briefSchema, normalizeBrief } from "../src/lib/agent/brief";
import { EXAMPLES, type Example } from "../src/lib/agent/examples";
import { FEATURED_FILE, loadFeatured, type FeaturedFile, type FeaturedItem } from "../src/lib/agent/featured";
import { TIMING, runPipeline } from "../src/lib/agent/pipeline";
import type { Treatment } from "../src/lib/agent/types";
import { Cooldowns, DailyBudget, createProviders, llmConfigFromEnv, type LlmConfig } from "../src/lib/llm";
import { createQlooClient, qlooConfigFromEnv } from "../src/lib/qloo";

for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // optional: a deploy sets the keys in its environment instead
  }
}

const args = process.argv.slice(2);
const ifMissing = args.includes("--if-missing");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const ATTEMPTS = 2;
/** Two runs at a time keep the Qloo calls well under the key's 10 requests a second. */
const PARALLEL = 2;

/** Why a run isn't good enough to feature, or null when it is. */
function problemWith(t: Treatment, wantDeepSeek: boolean): string | null {
  if (!t.complete) return "a Qloo call failed along the way";
  const degraded = t.llm.find((l) => l.degraded);
  if (degraded) return `the ${degraded.step} step fell back to the template`;
  if (wantDeepSeek && t.writtenBy.provider !== "deepseek") return `written by ${t.writtenBy.model}, not DeepSeek`;
  return null;
}

async function build(example: Example, llmConfig: LlmConfig, qloo: ReturnType<typeof createQlooClient>) {
  const brief = normalizeBrief(briefSchema.parse({ ...example.brief, thinking: "deep" }));
  let last = "no attempt finished";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const started = Date.now();
    // Fresh cooldowns per attempt: one slow call shouldn't bench DeepSeek for the retry.
    const llm = { mode: llmConfig.mode, providers: createProviders(llmConfig), budget: new DailyBudget(20), timeoutMs: llmConfig.timeoutMs, cooldowns: new Cooldowns() };
    try {
      const outcome = await runPipeline(brief, { qloo, llm }, () => {}, {
        id: `featured-${example.slug}`,
        signal: AbortSignal.timeout(TIMING.deep.runMs),
        deadline: started + TIMING.deep.runMs,
      });
      if (outcome.kind !== "treatment") {
        last = outcome.kind === "needs_input" ? "a title needs picking" : outcome.message;
        continue;
      }
      const problem = problemWith(outcome.treatment, Boolean(llmConfig.deepseekApiKey));
      if (!problem) {
        const seconds = Math.round((Date.now() - started) / 1000);
        return { item: { slug: example.slug, treatment: outcome.treatment }, note: `${seconds} s, ${outcome.treatment.writtenBy.model}` };
      }
      last = problem;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  return { item: undefined, note: `not built after ${ATTEMPTS} tries (${last})` };
}

async function inPool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await work(items[i]);
      }
    }),
  );
  return results;
}

async function main() {
  const existing = loadFeatured();
  if (ifMissing && existing.length > 0) {
    console.log(`Featured treatments: ${existing.length} already built (${FEATURED_FILE}); skipping.`);
    return;
  }
  const qlooConfig = qlooConfigFromEnv();
  const llmConfig = llmConfigFromEnv();
  if (qlooConfig.mode !== "live" || llmConfig.mode !== "live") {
    console.log("Featured treatments: skipped. They need live Qloo and a live model (QLOO_API_KEY plus an LLM key).");
    return;
  }
  const featured = EXAMPLES.filter((e) => e.featured);
  const targets = only ? featured.filter((e) => e.slug === only) : featured;
  if (targets.length === 0) {
    console.error(`No featured example has the slug "${only}". Featured: ${featured.map((e) => e.slug).join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Featured treatments: building ${targets.length} with deep thinking…`);
  const qloo = createQlooClient({ ...qlooConfig, cacheDir: undefined });
  const built = await inPool(targets, PARALLEL, (example) => build(example, llmConfig, qloo));

  const items: FeaturedItem[] = [];
  let missing = 0;
  for (const example of featured) {
    const i = targets.indexOf(example);
    const fresh = i === -1 ? undefined : built[i];
    const previous = existing.find((item) => item.slug === example.slug);
    const item = fresh?.item ?? previous;
    if (item) items.push(item);
    else missing += 1;
    if (fresh) {
      const kept = !fresh.item && previous ? "; kept the previous one" : "";
      console.log(`  ${fresh.item ? "built" : "FAILED"}  ${example.slug}  ${fresh.item ? `"${fresh.item.treatment.title}", ` : ""}${fresh.note}${kept}`);
    }
  }

  const file: FeaturedFile = { generatedAt: new Date().toISOString(), items };
  await mkdir(path.dirname(FEATURED_FILE), { recursive: true });
  await writeFile(`${FEATURED_FILE}.tmp`, JSON.stringify(file));
  await rename(`${FEATURED_FILE}.tmp`, FEATURED_FILE);
  console.log(`Featured treatments: ${items.length} of ${featured.length} in ${FEATURED_FILE}.`);
  // A deploy must not fail over a missing example (the board falls back to a plain button); a manual run should say so.
  if (missing > 0 && !ifMissing) process.exitCode = 1;
}

main();
