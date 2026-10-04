import { MCP_SESSION_PREFIX, SCOPES, isScope } from "@ultimyr/authz";
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, type Ctx } from "../ctx.js";
import { uuidv7 } from "../ids.js";
import { randomToken, safeEqual } from "../secrets.js";
import { parse } from "./core.js";

/** What a connected app may be granted. Sharing and AI use are opt in. */
export const DEFAULT_MCP_SCOPES = ["content:read", "content:write", "quiz:read", "quiz:write", "notes:use"];
export const MCP_ACCESS_TTL = 30 * 60;
const CODE_TTL_MS = 5 * 60_000;
const REFRESH_TTL_MS = 90 * 86_400_000;
const MAX_CLIENTS = 2000;
const MAX_CONNECTIONS_PER_USER = 50;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);

/** https, http on loopback only, or a private use app scheme. No fragments, no credentials. */
export function validRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  return !FORBIDDEN_SCHEMES.has(u.protocol);
}

const registerBody = z.object({
  client_name: z.string().trim().min(1).max(80).default("MCP client"),
  redirect_uris: z.array(z.string().max(500)).min(1).max(5),
  token_endpoint_auth_method: z.literal("none").optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});
const consentBody = z.object({
  clientId: z.string().min(1).max(100),
  redirectUri: z.string().max(500),
  scope: z.array(z.string()).min(1).max(SCOPES.length),
  state: z.string().max(500).optional(),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  approve: z.boolean(),
});
const tokenBody = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  code: z.string().max(200).optional(),
  redirect_uri: z.string().max(500).optional(),
  client_id: z.string().max(100).optional(),
  code_verifier: z.string().min(43).max(128).optional(),
  refresh_token: z.string().max(300).optional(),
});

const oauthError = (status: number, error: string, description: string) => new HttpError(status, error, { error_description: description });
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function oauthRoutes(ctx: Ctx) {
  const { pool, secrets, config } = ctx;
  const origin = config.publicUrl.replace(/\/$/, "");

  async function client(id: string) {
    const { rows } = await pool.query("SELECT * FROM auth.oauth_clients WHERE client_id = $1", [id]);
    return rows[0] as { client_id: string; client_name: string; redirect_uris: string[] } | undefined;
  }

  return async (r: FastifyInstance) => {
    r.get("/.well-known/oauth-authorization-server", async (_req, reply) => {
      reply.header("cache-control", "public, max-age=300");
      return {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        jwks_uri: `${origin}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: [...SCOPES],
      };
    });

    // Dynamic client registration (RFC 7591), public clients only.
    r.post("/oauth/register", { config: ctx.limit }, async (req, reply) => {
      const body = registerBody.safeParse(req.body ?? {});
      if (!body.success || !body.data.redirect_uris.every(validRedirectUri)) throw oauthError(400, "invalid_client_metadata", "redirect_uris must be https, http on localhost, or an app scheme");
      const { rows: n } = await pool.query("SELECT count(*)::int AS n FROM auth.oauth_clients");
      if (n[0].n >= MAX_CLIENTS) throw oauthError(429, "too_many_clients", "Client registration is full. Ask the administrator to clean up unused clients.");
      const clientId = `uc_${randomToken(18)}`;
      await pool.query("INSERT INTO auth.oauth_clients (client_id, client_name, redirect_uris) VALUES ($1,$2,$3)", [clientId, body.data.client_name, [...new Set(body.data.redirect_uris)]]);
      return reply.code(201).send({
        client_id: clientId,
        client_name: body.data.client_name,
        redirect_uris: [...new Set(body.data.redirect_uris)],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    });

    // The browser lands here. We check the request, then hand off to the web consent page. Bad client or redirect: never redirect, just refuse.
    r.get("/oauth/authorize", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const c = q.client_id ? await client(q.client_id) : undefined;
      if (!c || !q.redirect_uri || !c.redirect_uris.includes(q.redirect_uri)) throw oauthError(400, "invalid_request", "Unknown client or redirect_uri.");
      const back = (error: string, description: string) => {
        const u = new URL(q.redirect_uri!);
        u.searchParams.set("error", error);
        u.searchParams.set("error_description", description);
        if (q.state) u.searchParams.set("state", q.state);
        return reply.redirect(u.toString());
      };
      if (q.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
      if (!q.code_challenge || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) return back("invalid_request", "PKCE with S256 is required.");
      const scopes = q.scope ? q.scope.split(/\s+/).filter(Boolean) : DEFAULT_MCP_SCOPES;
      if (!scopes.length || !scopes.every(isScope)) return back("invalid_scope", "Unknown scope.");
      const to = new URL(`${origin}/connect`);
      to.searchParams.set("client_id", c.client_id);
      to.searchParams.set("redirect_uri", q.redirect_uri);
      to.searchParams.set("scope", scopes.join(" "));
      to.searchParams.set("code_challenge", q.code_challenge);
      if (q.state) to.searchParams.set("state", q.state);
      return reply.redirect(to.toString());
    });

    // Used by the consent page to show who is asking.
    r.get("/v1/oauth/clients/:id", async (req) => {
      await ctx.authenticateInteractive(req);
      const c = await client((req.params as { id: string }).id);
      if (!c) throw new HttpError(404, "not_found");
      return { clientId: c.client_id, name: c.client_name, redirectUris: c.redirect_uris };
    });

    // The signed in person approves or denies. Returns where to send the browser.
    r.post("/v1/oauth/consent", { config: ctx.limit }, async (req) => {
      const { user } = await ctx.authenticateInteractive(req);
      const body = parse(consentBody, req.body);
      const c = await client(body.clientId);
      if (!c || !c.redirect_uris.includes(body.redirectUri)) throw new HttpError(400, "invalid_request", { issues: ["unknown client or redirect_uri"] });
      if (!body.scope.every(isScope)) throw new HttpError(400, "invalid_request", { issues: ["scope: unknown scope"] });
      const to = new URL(body.redirectUri);
      if (body.state) to.searchParams.set("state", body.state);
      if (!body.approve) {
        to.searchParams.set("error", "access_denied");
        return { redirectTo: to.toString() };
      }
      const { rows: n } = await pool.query("SELECT count(*)::int AS n FROM auth.mcp_connections WHERE user_id = $1 AND revoked_at IS NULL", [user.id]);
      if (n[0].n >= MAX_CONNECTIONS_PER_USER) throw new HttpError(409, "too_many_connections", { max: MAX_CONNECTIONS_PER_USER });
      const code = randomToken(32);
      await pool.query("INSERT INTO auth.oauth_codes (code_hash, client_id, user_id, scopes, redirect_uri, code_challenge, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
        secrets.hashToken(code),
        c.client_id,
        user.id,
        [...new Set(body.scope)],
        body.redirectUri,
        body.codeChallenge,
        new Date(Date.now() + CODE_TTL_MS),
      ]);
      await ctx.audit("mcp.authorized", req, user.id, c.client_id, { scopes: body.scope, client: c.client_name });
      to.searchParams.set("code", code);
      to.searchParams.set("iss", origin);
      return { redirectTo: to.toString() };
    });

    r.post("/oauth/token", { config: ctx.limit }, async (req, reply) => {
      reply.header("cache-control", "no-store").header("pragma", "no-cache");
      const parsed = tokenBody.safeParse(req.body ?? {});
      if (!parsed.success) throw oauthError(400, "invalid_request", "Malformed token request.");
      const b = parsed.data;
      const issue = async (conn: { id: string; user_id: string; scopes: string[] }, refreshSecret: string) => {
        const { rows } = await pool.query("SELECT status FROM auth.users WHERE id = $1", [conn.user_id]);
        if (rows[0]?.status !== "active") throw oauthError(400, "invalid_grant", "Account is not active.");
        const accessToken = await ctx.signAccess({ userId: conn.user_id, sessionId: `${MCP_SESSION_PREFIX}${conn.id}`, roles: await ctx.rolesFor(conn.user_id), scopes: conn.scopes, amr: ["oauth"], ttl: MCP_ACCESS_TTL });
        return { access_token: accessToken, token_type: "Bearer", expires_in: MCP_ACCESS_TTL, refresh_token: `${conn.id}.${refreshSecret}`, scope: conn.scopes.join(" ") };
      };

      if (b.grant_type === "authorization_code") {
        if (!b.code || !b.redirect_uri || !b.client_id || !b.code_verifier) throw oauthError(400, "invalid_request", "code, redirect_uri, client_id and code_verifier are required.");
        // Burn the code first so a replay or a failed PKCE check cannot be retried.
        const { rows } = await pool.query(
          "UPDATE auth.oauth_codes SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING *",
          [secrets.hashToken(b.code)],
        );
        const c = rows[0];
        if (!c || c.client_id !== b.client_id || c.redirect_uri !== b.redirect_uri || !safeEqual(s256(b.code_verifier), c.code_challenge)) throw oauthError(400, "invalid_grant", "The code is invalid, expired or already used.");
        const cl = await client(c.client_id);
        const id = uuidv7();
        const refreshSecret = randomToken(32);
        await pool.query("INSERT INTO auth.mcp_connections (id, user_id, client_id, client_name, scopes, refresh_hash, expires_at, last_used_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now())", [
          id,
          c.user_id,
          c.client_id,
          cl?.client_name ?? "MCP client",
          c.scopes,
          secrets.hashToken(`${id}.${refreshSecret}`),
          new Date(Date.now() + REFRESH_TTL_MS),
        ]);
        return issue({ id, user_id: c.user_id, scopes: c.scopes }, refreshSecret);
      }

      // refresh_token: rotate on every use. Presenting an old token means it leaked, so the whole connection is revoked.
      const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/.exec(b.refresh_token ?? "");
      if (!m) throw oauthError(400, "invalid_grant", "Invalid refresh token.");
      const newSecret = randomToken(32);
      const { rows } = await pool.query(
        `UPDATE auth.mcp_connections SET refresh_hash = $3, last_used_at = now(), expires_at = $4
          WHERE id = $1 AND refresh_hash = $2 AND revoked_at IS NULL AND expires_at > now() AND ($5::text IS NULL OR client_id = $5) RETURNING *`,
        [m[1], secrets.hashToken(b.refresh_token!), secrets.hashToken(`${m[1]}.${newSecret}`), new Date(Date.now() + REFRESH_TTL_MS), b.client_id ?? null],
      );
      if (!rows[0]) {
        await pool.query("UPDATE auth.mcp_connections SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [m[1]]);
        throw oauthError(400, "invalid_grant", "Invalid or reused refresh token. The connection was revoked.");
      }
      return issue(rows[0], newSecret);
    });

    // Connected apps, newest first. Revoking stops refresh at once; an access token already issued lasts up to 30 minutes.
    r.get("/v1/me/mcp-connections", async (req) => {
      const { user } = await ctx.authenticateInteractive(req);
      const { rows } = await pool.query("SELECT * FROM auth.mcp_connections WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC", [user.id]);
      return rows.map((c) => ({ id: c.id, clientName: c.client_name, scopes: c.scopes, createdVia: c.created_via, createdAt: c.created_at, lastUsedAt: c.last_used_at }));
    });

    r.delete("/v1/me/mcp-connections/:id", async (req, reply) => {
      const { user } = await ctx.authenticateInteractive(req);
      const id = (req.params as { id: string }).id;
      const { rowCount } = await pool.query("UPDATE auth.mcp_connections SET revoked_at = now() WHERE id::text = $1 AND user_id = $2 AND revoked_at IS NULL", [id, user.id]);
      if (!rowCount) throw new HttpError(404, "not_found");
      await ctx.audit("mcp.revoked", req, user.id, id);
      return reply.code(204).send();
    });
  };
}
