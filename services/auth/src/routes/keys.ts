import { API_KEY_SESSION_PREFIX, SCOPES, isScope } from "@ultimyr/authz";
import { and, eq, ne, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, type Ctx } from "../ctx.js";
import { uuidv7 } from "../ids.js";
import { apiKeys, sessions, users } from "../schema.js";
import { randomToken, safeEqual } from "../secrets.js";
import { parse } from "./core.js";

const MAX_KEYS_PER_USER = 25;
const KEY_TOKEN_TTL = 10 * 60;

const createBody = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.string()).min(1).max(SCOPES.length),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** Keys look like ulk_<8 hex prefix>_<secret>. Only a keyed hash of the whole key is stored. */
function parseKey(raw: string): { prefix: string; full: string } | null {
  const m = /^ulk_([0-9a-f]{8})_([A-Za-z0-9_-]{32,})$/.exec(raw.trim());
  return m ? { prefix: m[1]!, full: raw.trim() } : null;
}

export function keyRoutes(ctx: Ctx) {
  const { db, secrets, limit } = ctx;

  return async (r: FastifyInstance) => {
    r.get("/v1/me/api-keys", async (req) => {
      const { user } = await ctx.authenticateInteractive(req);
      const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, user.id));
      return rows.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: `ulk_${k.prefix}`,
        scopes: k.scopes,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        expiresAt: k.expiresAt,
        revokedAt: k.revokedAt,
      }));
    });

    r.post("/v1/me/api-keys", async (req, reply) => {
      const { user } = await ctx.authenticateInteractive(req);
      const body = parse(createBody, req.body);
      const unknown = body.scopes.filter((s) => !isScope(s));
      if (unknown.length) throw new HttpError(400, "unknown_scope", { scopes: unknown });
      const [{ n } = { n: 0 }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, user.id), sql`${apiKeys.revokedAt} IS NULL`));
      if (n >= MAX_KEYS_PER_USER) throw new HttpError(409, "too_many_keys");

      const prefix = randomBytes(4).toString("hex");
      const full = `ulk_${prefix}_${randomToken(32)}`;
      const id = uuidv7();
      const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null;
      await db.insert(apiKeys).values({ id, userId: user.id, name: body.name, prefix, keyHash: secrets.hashToken(full), scopes: [...new Set(body.scopes)], expiresAt });
      await ctx.audit("apikey.created", req, user.id, id, { scopes: body.scopes });
      // The only time the full key is ever shown.
      return reply.code(201).send({ id, name: body.name, key: full, scopes: body.scopes, expiresAt });
    });

    r.delete("/v1/me/api-keys/:id", async (req, reply) => {
      const { user } = await ctx.authenticateInteractive(req);
      const { id } = req.params as { id: string };
      const res = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, user.id), sql`${apiKeys.revokedAt} IS NULL`))
        .returning({ id: apiKeys.id })
        .catch(() => []);
      if (!res.length) throw new HttpError(404, "not_found");
      await ctx.audit("apikey.revoked", req, user.id, id);
      return reply.code(204).send();
    });

    // Exchange an API key for a short-lived, scope-limited access token.
    r.post("/v1/auth/token", { config: limit }, async (req) => {
      const raw = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
      const parsed = parseKey(raw);
      const fail = () => new HttpError(401, "invalid_api_key");
      if (!parsed) throw fail();
      const [k] = await db.select().from(apiKeys).where(eq(apiKeys.prefix, parsed.prefix));
      if (!k || !safeEqual(k.keyHash, secrets.hashToken(parsed.full))) throw fail();
      if (k.revokedAt || (k.expiresAt && k.expiresAt < new Date())) throw fail();
      const [user] = await db.select().from(users).where(eq(users.id, k.userId));
      if (!user || user.status !== "active") throw fail();
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
      const roles = await ctx.rolesFor(user.id);
      const accessToken = await ctx.signAccess({
        userId: user.id,
        sessionId: `${API_KEY_SESSION_PREFIX}${k.id}`,
        roles,
        scopes: k.scopes,
        amr: ["apikey"],
        ttl: KEY_TOKEN_TTL,
      });
      return { accessToken, expiresIn: KEY_TOKEN_TTL, scopes: k.scopes };
    });

    // Browser sessions
    r.get("/v1/me/sessions", async (req) => {
      const { user, principal } = await ctx.authenticateInteractive(req);
      const rows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), sql`${sessions.revokedAt} IS NULL`, sql`${sessions.expiresAt} > now()`));
      return rows.map((s) => ({
        id: s.id,
        current: s.id === principal.sessionId,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        amr: s.amr,
      }));
    });

    // Sign out every other device, keeping the one making the request.
    r.delete("/v1/me/sessions", async (req) => {
      const { user, principal } = await ctx.authenticateInteractive(req);
      const res = await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, user.id), sql`${sessions.revokedAt} IS NULL`, ne(sessions.id, principal.sessionId)))
        .returning({ id: sessions.id });
      await ctx.audit("session.revoked_others", req, user.id, null, { count: res.length });
      return { revoked: res.length };
    });

    r.delete("/v1/me/sessions/:id", async (req, reply) => {
      const { user } = await ctx.authenticateInteractive(req);
      const { id } = req.params as { id: string };
      const res = await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.id, id), eq(sessions.userId, user.id), sql`${sessions.revokedAt} IS NULL`))
        .returning({ id: sessions.id })
        .catch(() => []);
      if (!res.length) throw new HttpError(404, "not_found");
      await ctx.audit("session.revoked", req, user.id, id);
      return reply.code(204).send();
    });
  };
}
