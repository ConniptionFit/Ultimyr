import { resolve } from "node:path";
import type { NextConfig } from "next";

// Forward API paths to the auth service. This makes the web container the single public
// upstream (one Nginx Proxy Manager host, no custom locations). Reverse proxies that route
// /api/v1/* straight to auth (Traefik, headless setups) never reach these rewrites.
// NOTE: rewrites are resolved at build time, so AUTH_URL is a Docker build arg.
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
