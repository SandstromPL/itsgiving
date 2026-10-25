import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Featured treatments are built at deploy time into .cache/ (gitignored, like all Qloo data); the
  // treatment route reads them at runtime, so its server bundle has to carry the file.
  outputFileTracingIncludes: {
    "/api/treatment": ["./.cache/featured/**/*"],
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
