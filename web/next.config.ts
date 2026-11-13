import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// API keys live in the repo-root .env (shared with the Python scripts in scripts/).
// forceReload: Next already ran loadEnvConfig for web/ and would otherwise return that cached result.
loadEnvConfig(path.resolve(process.cwd(), ".."), process.env.NODE_ENV !== "production", undefined, true);

const nextConfig: NextConfig = {
  /* config options here */
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
