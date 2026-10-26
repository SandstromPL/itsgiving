import type { NextConfig } from "next";

// A NEXT_PUBLIC_ value is written into the browser's code at build. A secret key pasted there by mistake would ship to
// every visitor, so the build stops instead.
if (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim().startsWith("sb_secret_")) {
  throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key. Use the publishable key (sb_publishable_...).");
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // On every page: no framing (a saved treatment's page has one-click Share and Delete), no sniffing, and the browser's
  // usual referrer, written out (OpenStreetMap's tiles need the site's address in it).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
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
