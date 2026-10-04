import { resolve } from "node:path";
import type { NextConfig } from "next";

// Dev and single-container fallback: forward API paths to the auth service.
// In Docker Compose, Traefik routes /api/v1/* before requests reach this app.
const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:4001";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  transpilePackages: ["@ultimyr/lore", "@ultimyr/ui-icons"],
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/api/v1/auth/:path*", destination: `${AUTH_URL}/v1/auth/:path*` },
      { source: "/api/v1/me", destination: `${AUTH_URL}/v1/me` },
    ];
  },
};

export default config;
