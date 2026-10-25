import { connection } from "next/server";
import { llmConfigFromEnv } from "@/lib/llm/config";
import { qlooConfigFromEnv } from "@/lib/qloo";
import { ModeBadges } from "./parts";

/**
 * The data-source badges, read at request time. Without connection() the
 * page would be prerendered and show whatever keys the build machine had.
 */
export async function LiveModes() {
  await connection();
  return <ModeBadges qloo={qlooConfigFromEnv().mode} llm={llmConfigFromEnv().mode} />;
}
