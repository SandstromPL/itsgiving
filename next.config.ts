import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Featured treatments are built at deploy time into .cache/ (gitignored, like all Qloo data). The treatment
  // route reads them at runtime, and the pages built from them may be rendered again at request time (for bots
  // that read only HTML), so each of their server bundles has to carry the file.
  outputFileTracingIncludes: {
    "/api/treatment": ["./.cache/featured/**/*"],
    "/": ["./.cache/featured/**/*"],
    "/t/[slug]": ["./.cache/featured/**/*"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
