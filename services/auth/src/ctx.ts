import { AUDIENCE, API_KEY_SESSION_PREFIX, ISSUER, verifyAccessToken, type Principal, type Role } from "@ultimyr/authz";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import type { Pool } from "pg";
import type { AuthConfig } from "./config.js";
import { uuidv7 } from "./ids.js";
import type { SigningKeys } from "./keys.js";
import { apiKeys, auditLog, roleAssignments, sessions, users } from "./schema.js";
import { randomToken, sha256Hex, type Secrets } from "./secrets.js";

export const ACCESS_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE = "ultimyr_rt";
export const COOKIE_PATH = "/api/v1/auth";
const MFA_AUDIENCE = "ultimyr-mfa";

export type Db = NodePgDatabase<Record<string, never>>;
export type User = typeof users.$inferSelect;

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export interface Authed {
  principal: Principal;
  user: User;
}

export interface Ctx {
  pool: Pool;
  db: Db;
  config: AuthConfig;
  keys: SigningKeys;
  secrets: Secrets;
  /** Route config enabling the per-IP rate limit on credential endpoints. */
  limit: { rateLimit: { max: number; timeWindow: string } };
  audit(action: string, req: FastifyRequest, actorId?: string | null, target?: string | null, metadata?: Record<string, unknown>): Promise<void>;
  rolesFor(userId: string): Promise<Role[]>;
  signAccess(p: { userId: string; sessionId: string; roles: Role[]; scopes?: string[]; amr: string[]; ttl?: number }): Promise<string>;
  startSession(req: FastifyRequest, reply: FastifyReply, userId: string, amr: string[]): Promise<{ accessToken: string; expiresIn: number; user: ReturnType<Ctx["publicUser"]> }>;
  setRefreshCookie(reply: FastifyReply, sessionId: string, secret: string): void;
  clearRefreshCookie(reply: FastifyReply): void;
  publicUser(u: User, roles: Role[]): { id: string; email: string; displayName: string; roles: Role[] };
  signMfaToken(userId: string): Promise<string>;
  verifyMfaToken(token: string): Promise<string>;
  authenticate(req: FastifyRequest): Promise<Authed>;
  /** Like authenticate, but rejects API-key tokens: account security changes need a real sign-in. */
  authenticateInteractive(req: FastifyRequest): Promise<Authed>;
  requireAdmin(req: FastifyRequest): Promise<Authed>;
}

export function createCtx(base: Pick<Ctx, "pool" | "db" | "config" | "keys" | "secrets" | "limit">): Ctx {
  const { db, config, keys } = base;

  const ctx: Ctx = {
    ...base,

    async audit(action, req, actorId, target, metadata) {
      await db.insert(auditLog).values({
        action,
        actorId: actorId ?? null,
        target: target ?? null,
        ip: req.ip,
        metadata: metadata ?? {},
      });
    },

    async rolesFor(userId) {
      const rows = await db.select({ role: roleAssignments.role }).from(roleAssignments).where(eq(roleAssignments.userId, userId));
      return rows.map((r) => r.role as Role);
    },

    signAccess({ userId, sessionId, roles, scopes = [], amr, ttl = ACCESS_TTL_SECONDS }) {
      return new SignJWT({ sid: sessionId, roles, scopes, amr })
        .setProtectedHeader({ alg: "EdDSA", kid: keys.kid })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ttl}s`)
        .sign(keys.privateKey);
    },

    setRefreshCookie(reply, sessionId, secret) {
      reply.setCookie(REFRESH_COOKIE, `${sessionId}.${secret}`, {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: "lax",
        path: COOKIE_PATH,
        maxAge: SESSION_TTL_MS / 1000,
      });
    },

    clearRefreshCookie(reply) {
      reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    },

    publicUser: (u, roles) => ({ id: u.id, email: u.email, displayName: u.displayName, roles }),

    async startSession(req, reply, userId, amr) {
      const sessionId = uuidv7();
      const secret = randomToken();
      await db.insert(sessions).values({
        id: sessionId,
        userId,
        refreshHash: sha256Hex(secret),
        userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
        ip: req.ip,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        amr,
      });
      ctx.setRefreshCookie(reply, sessionId, secret);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const roles = await ctx.rolesFor(userId);
      return {
        accessToken: await ctx.signAccess({ userId, sessionId, roles, amr }),
        expiresIn: ACCESS_TTL_SECONDS,
        user: ctx.publicUser(user!, roles),
      };
    },

    signMfaToken(userId) {
      return new SignJWT({})
        .setProtectedHeader({ alg: "EdDSA", kid: keys.kid })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(MFA_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keys.privateKey);
    },

    async verifyMfaToken(token) {
      try {
        const { payload } = await jwtVerify(token, keys.publicKey, { issuer: ISSUER, audience: MFA_AUDIENCE, algorithms: ["EdDSA"] });
        if (!payload.sub) throw new Error("no subject");
        return payload.sub;
      } catch {
        throw new HttpError(401, "invalid_mfa_token");
      }
    },

    async authenticate(req) {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) throw new HttpError(401, "unauthenticated");
      let principal: Principal;
      try {
        principal = await verifyAccessToken(header.slice(7), keys.publicKey);
      } catch {
        throw new HttpError(401, "unauthenticated");
      }
      if (principal.sessionId.startsWith(API_KEY_SESSION_PREFIX)) {
        const keyId = principal.sessionId.slice(API_KEY_SESSION_PREFIX.length);
        const [k] = await db
          .select({ revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt })
          .from(apiKeys)
          .where(eq(apiKeys.id, keyId))
          .catch(() => []);
        if (!k || k.revokedAt || (k.expiresAt && k.expiresAt < new Date())) throw new HttpError(401, "unauthenticated");
      } else {
        const [s] = await db.select().from(sessions).where(and(eq(sessions.id, principal.sessionId), sql`${sessions.revokedAt} IS NULL`));
        if (!s || s.expiresAt < new Date()) throw new HttpError(401, "unauthenticated");
      }
      const [user] = await db.select().from(users).where(eq(users.id, principal.userId));
      if (!user || user.status !== "active") throw new HttpError(401, "unauthenticated");
      return { principal, user };
    },

    async authenticateInteractive(req) {
      const a = await ctx.authenticate(req);
      if (a.principal.sessionId.startsWith(API_KEY_SESSION_PREFIX)) throw new HttpError(403, "interactive_session_required");
      return a;
    },

    async requireAdmin(req) {
      const a = await ctx.authenticateInteractive(req);
      if (!a.principal.roles.includes("platform_admin")) throw new HttpError(403, "forbidden");
      return a;
    },
  };
  return ctx;
}
