import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The training copy (T-24) builds into its own folder so it can run next to the normal app.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
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
