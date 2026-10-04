import { resolve } from "node:path";
import type { NextConfig } from "next";

// Forward API paths to the auth service. This makes the web container the single public
// upstream (one Nginx Proxy Manager host, no custom locations). Reverse proxies that route
// /api/v1/* straight to auth (Traefik, headless setups) never reach these rewrites.
// NOTE: rewrites are resolved at build time, so AUTH_URL and CONTENT_URL (and the quiz, AI, notes and MCP URLs) are Docker build args.
const AUTH_URL = process.env.AUTH_URL ?? "http://localhost:4001";
const CONTENT_URL = process.env.CONTENT_URL ?? "http://localhost:4002";
const QUIZ_URL = process.env.QUIZ_URL ?? "http://localhost:4003";
const AI_URL = process.env.AI_URL ?? "http://localhost:4004";
const MCP_URL = process.env.MCP_URL ?? "http://localhost:4005";
const NOTES_URL = process.env.NOTES_URL ?? "http://localhost:4006";

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  transpilePackages: ["@ultimyr/lore", "@ultimyr/ui-icons", "@ultimyr/coverage", "@ultimyr/bundle"],
  poweredByHeader: false,
  async headers() {
    // The consent page must never be framed (clickjacking).
    const baseline = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    return [
      { source: "/:path*", headers: baseline },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/connect", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/v1/auth/:path*", destination: `${AUTH_URL}/v1/auth/:path*` },
      ...["archives", "items", "cards", "search", "import", "trash", "assets", "access", "study", "resources", "roadmap", "roadmaps", "credentials"].flatMap((p) => [
        { source: `/api/v1/${p}`, destination: `${CONTENT_URL}/v1/${p}` },
        { source: `/api/v1/${p}/:path*`, destination: `${CONTENT_URL}/v1/${p}/:path*` },
      ]),
      ...["quizzes", "questions", "attempts", "scoring-profiles", "analytics", "goals", "drills", "plan"].flatMap((p) => [
        { source: `/api/v1/${p}`, destination: `${QUIZ_URL}/v1/${p}` },
        { source: `/api/v1/${p}/:path*`, destination: `${QUIZ_URL}/v1/${p}/:path*` },
      ]),
      { source: "/api/v1/notes", destination: `${NOTES_URL}/v1/notes` },
      { source: "/api/v1/notes/:path*", destination: `${NOTES_URL}/v1/notes/:path*` },
      { source: "/api/v1/ai", destination: `${AI_URL}/v1/ai` },
      { source: "/api/v1/ai/:path*", destination: `${AI_URL}/v1/ai/:path*` },
      { source: "/api/v1/oauth/:path*", destination: `${AUTH_URL}/v1/oauth/:path*` },
      // OAuth for MCP clients: endpoints on auth, the MCP server and its metadata on mcp.
      { source: "/oauth/:path(register|token|authorize)", destination: `${AUTH_URL}/oauth/:path` },
      { source: "/.well-known/oauth-authorization-server", destination: `${AUTH_URL}/.well-known/oauth-authorization-server` },
      { source: "/.well-known/oauth-protected-resource", destination: `${MCP_URL}/.well-known/oauth-protected-resource` },
      { source: "/.well-known/oauth-protected-resource/mcp", destination: `${MCP_URL}/.well-known/oauth-protected-resource/mcp` },
      { source: "/mcp", destination: `${MCP_URL}/mcp` },
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
