import { llmConfigFromEnv } from "@/lib/llm/config";
import { qlooConfigFromEnv } from "@/lib/qloo";
import { Studio } from "./studio/studio";

export default function Home() {
  return <Studio qlooMode={qlooConfigFromEnv().mode} llmMode={llmConfigFromEnv().mode} />;
}
