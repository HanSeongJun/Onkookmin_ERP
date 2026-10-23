import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      // 자료일괄등록 sends up to 3,000 rows of an Excel file to one Server
      // Action (default limit: 1MB). Kept below the proxy's 10MB request
      // buffer (proxyClientMaxBodySize), so a request is never cut short.
      bodySizeLimit: "8mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
