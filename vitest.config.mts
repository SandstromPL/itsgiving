import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests must never hit the live Qloo API or depend on a local key.
    env: { QLOO_MODE: "mock", QLOO_API_KEY: "", QLOO_CACHE_DIR: "" },
  },
});
