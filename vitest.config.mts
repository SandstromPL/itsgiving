import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Next resolves "server-only" to an empty module on the server; outside Next it throws, so tests take the empty one.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests must never hit the live Qloo API or depend on a local key.
    env: { QLOO_MODE: "mock", QLOO_API_KEY: "", QLOO_CACHE_DIR: "" },
  },
});
