import { resolve } from "node:path";
import type { NextConfig } from "next";

// Forward API paths to the auth service. This makes the web container the single public
// upstream (one Nginx Proxy Manager host, no custom locations). Reverse proxies that route
// /api/v1/* straight to auth (Traefik, headless setups) never reach these rewrites.
// NOTE: rewrites are resolved at build time, so AUTH_URL and CONTENT_URL (and the quiz, AI and MCP URLs) are Docker build args.
const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:4001";
const CONTENT_URL = process.env.CONTENT_URL ?? "http://localhost:4002";
const QUIZ_URL = process.env.QUIZ_URL ?? "http://localhost:4003";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  transpilePackages: ["@ultimyr/lore", "@ultimyr/ui-icons"],
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/api/v1/auth/:path*", destination: `${AUTH_URL}/v1/auth/:path*` },
      ...["archives", "items", "cards", "search", "import", "trash", "assets", "access", "study"].flatMap((p) => [
        { source: `/api/v1/${p}`, destination: `${CONTENT_URL}/v1/${p}` },
        { source: `/api/v1/${p}/:path*`, destination: `${CONTENT_URL}/v1/${p}/:path*` },
      ]),
      ...["quizzes", "questions", "attempts", "scoring-profiles", "analytics", "goals"].flatMap((p) => [
        { source: `/api/v1/${p}`, destination: `${QUIZ_URL}/v1/${p}` },
        { source: `/api/v1/${p}/:path*`, destination: `${QUIZ_URL}/v1/${p}/:path*` },
      ]),
      { source: "/api/v1/users/lookup", destination: `${AUTH_URL}/v1/users/lookup` },
      { source: "/api/v1/groups", destination: `${AUTH_URL}/v1/groups` },
      { source: "/api/v1/me", destination: `${AUTH_URL}/v1/me` },
      { source: "/api/v1/me/:path*", destination: `${AUTH_URL}/v1/me/:path*` },
      { source: "/api/v1/admin/:path*", destination: `${AUTH_URL}/v1/admin/:path*` },
      { source: "/scim/v2/:path*", destination: `${AUTH_URL}/scim/v2/:path*` },
      { source: "/.well-known/jwks.json", destination: `${AUTH_URL}/.well-known/jwks.json` },
    ];
  },
};

export default config;
