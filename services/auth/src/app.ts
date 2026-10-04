import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { hash, verify } from "@node-rs/argon2";
import { AUDIENCE, ISSUER, verifyAccessToken, type Role } from "@ultimyr/authz";
import { and, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { SignJWT } from "jose";
import type { Pool } from "pg";
import { z } from "zod";
import type { AuthConfig } from "./config.js";
import { uuidv7 } from "./ids.js";
import type { SigningKeys } from "./keys.js";
import { auditLog, roleAssignments, sessions, users } from "./schema.js";

const ACCESS_TTL_SECONDS = 10 * 60;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE = "ultimyr_rt";

const registerBody = z.object({
  email: z.email().max(254),
  password: z.string().min(12, "Password must be at least 12 characters").max(128),
  displayName: z.string().trim().min(1).max(80),
});
const loginBody = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });

export interface AppDeps {
  pool: Pool;
  config: AuthConfig;
  keys: SigningKeys;
  /** Per-minute cap on credential endpoints, per IP. */
  rateLimitMax?: number;
}

type Db = NodePgDatabase<Record<string, never>>;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { pool, config, keys } = deps;
  const db: Db = drizzle(pool);
  const app = Fastify({ logger: config.nodeEnv === "test" ? false : { level: "info" }, trustProxy: true });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // Burn a hash on unknown emails so login timing does not reveal which accounts exist.
  const dummyHash = await hash("ultimyr-dummy-password");
  const limit = { rateLimit: { max: deps.rateLimitMax ?? 10, timeWindow: "1 minute" } };

  async function audit(action: string, req: FastifyRequest, actorId?: string, target?: string) {
    await db.insert(auditLog).values({ action, actorId: actorId ?? null, target: target ?? null, ip: req.ip });
  }

  async function rolesFor(userId: string): Promise<Role[]> {
    const rows = await db.select({ role: roleAssignments.role }).from(roleAssignments).where(eq(roleAssignments.userId, userId));
    return rows.map((r) => r.role as Role);
  }

  async function signAccess(userId: string, sessionId: string, roles: Role[]) {
    return new SignJWT({ sid: sessionId, roles, scopes: [] })
      .setProtectedHeader({ alg: "EdDSA", kid: keys.kid })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(keys.privateKey);
  }

  function setRefreshCookie(reply: FastifyReply, sessionId: string, secret: string) {
    reply.setCookie(REFRESH_COOKIE, `${sessionId}.${secret}`, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax",
      path: "/api/v1/auth",
      maxAge: SESSION_TTL_MS / 1000,
    });
  }

  async function startSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
    const sessionId = uuidv7();
    const secret = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      refreshHash: sha256(secret),
      userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null,
      ip: req.ip,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });
    setRefreshCookie(reply, sessionId, secret);
    const roles = await rolesFor(userId);
    return { accessToken: await signAccess(userId, sessionId, roles), expiresIn: ACCESS_TTL_SECONDS };
  }

  const publicUser = (u: typeof users.$inferSelect, roles: Role[]) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    roles,
  });

  // Routes are served both at `/...` and `/api/...`, so a reverse proxy can forward
  // /api/v1/* untouched (no path rewriting) and internal callers can use the bare paths.
  const routes = async (r: FastifyInstance) => {
    // ---- health -------------------------------------------------------------
    r.get("/healthz", async () => ({ status: "ok" }));
    r.get("/readyz", async (_req, reply) => {
      try {
        await pool.query("SELECT 1");
        return { status: "ready" };
      } catch {
        return reply.code(503).send({ status: "unavailable" });
      }
    });

    // ---- keys ---------------------------------------------------------------
    r.get("/.well-known/jwks.json", async (_req, reply) => {
      reply.header("cache-control", "public, max-age=300");
      return { keys: [keys.publicJwk] };
    });

    // ---- register -----------------------------------------------------------
    r.post("/v1/auth/register", { config: limit }, async (req, reply) => {
      const parsed = registerBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues.map((i) => i.message) });
      const { email, password, displayName } = parsed.data;
      const passwordHash = await hash(password);
      const userId = uuidv7();

      const result = await db.transaction(async (tx) => {
        // Serialise first-user detection so two simultaneous sign-ups cannot both become admin.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ultimyr_first_user'))`);
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
        const first = n === 0;
        if (!first && !config.registrationOpen) return "closed" as const;
        const exists = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${email})`);
        if (exists.length) return "exists" as const;
        await tx.insert(users).values({ id: userId, email, displayName, passwordHash });
        const roles: Role[] = first ? ["platform_admin", "org_admin", "author", "learner"] : ["author", "learner"];
        await tx.insert(roleAssignments).values(roles.map((role) => ({ userId, role })));
        return first ? ("first" as const) : ("ok" as const);
      });

      if (result === "closed") return reply.code(403).send({ error: "registration_closed" });
      if (result === "exists") return reply.code(409).send({ error: "email_taken" });

      await audit(result === "first" ? "user.bootstrap_admin" : "user.register", req, userId, userId);
      const session = await startSession(req, reply, userId);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      return reply.code(201).send({ ...session, user: publicUser(user!, await rolesFor(userId)) });
    });

    // ---- login --------------------------------------------------------------
    r.post("/v1/auth/login", { config: limit }, async (req, reply) => {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
      const { email, password } = parsed.data;
      const [user] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);

      const ok = await verify(user?.passwordHash ?? dummyHash, password).catch(() => false);
      if (!user || !user.passwordHash || !ok || user.status !== "active") {
        await audit("login.failed", req, user?.id);
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      await audit("login.success", req, user.id);
      const session = await startSession(req, reply, user.id);
      return { ...session, user: publicUser(user, await rolesFor(user.id)) };
    });

    // ---- refresh (rotating, with reuse detection) -----------------------------
    r.post("/v1/auth/refresh", { config: limit }, async (req, reply) => {
      const raw = req.cookies[REFRESH_COOKIE];
      const [sessionId, secret] = raw?.split(".") ?? [];
      const fail = () => {
        reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
        return reply.code(401).send({ error: "invalid_session" });
      };
      if (!sessionId || !secret) return fail();

      const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).catch(() => []);
      if (!s || s.revokedAt || s.expiresAt < new Date()) return fail();

      const presented = sha256(secret);
      if (safeEq(presented, s.refreshHash)) {
        const next = randomBytes(32).toString("base64url");
        await db
          .update(sessions)
          .set({ refreshHash: sha256(next), prevRefreshHash: s.refreshHash, lastSeenAt: new Date() })
          .where(eq(sessions.id, s.id));
        const [user] = await db.select().from(users).where(eq(users.id, s.userId));
        if (!user || user.status !== "active") return fail();
        setRefreshCookie(reply, s.id, next);
        const roles = await rolesFor(user.id);
        return { accessToken: await signAccess(user.id, s.id, roles), expiresIn: ACCESS_TTL_SECONDS, user: publicUser(user, roles) };
      }
      if (s.prevRefreshHash && safeEq(presented, s.prevRefreshHash)) {
        // A rotated-out token came back: assume theft and kill the whole session.
        await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, s.id));
        await audit("session.reuse_detected", req, s.userId, s.id);
      }
      return fail();
    });

    // ---- logout ---------------------------------------------------------------
    r.post("/v1/auth/logout", async (req, reply) => {
      const [sessionId] = req.cookies[REFRESH_COOKIE]?.split(".") ?? [];
      if (sessionId) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.id, sessionId), sql`${sessions.revokedAt} IS NULL`))
          .catch(() => undefined);
      }
      reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
      return reply.code(204).send();
    });

    // ---- me -------------------------------------------------------------------
    r.get("/v1/me", async (req, reply) => {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthenticated" });
      try {
        const principal = await verifyAccessToken(header.slice(7), keys.publicKey);
        const [s] = await db.select().from(sessions).where(eq(sessions.id, principal.sessionId));
        if (!s || s.revokedAt) return reply.code(401).send({ error: "unauthenticated" });
        const [user] = await db.select().from(users).where(eq(users.id, principal.userId));
        if (!user || user.status !== "active") return reply.code(401).send({ error: "unauthenticated" });
        return publicUser(user, await rolesFor(user.id));
      } catch {
        return reply.code(401).send({ error: "unauthenticated" });
      }
    });
  };
  await app.register(routes);
  await app.register(routes, { prefix: "/api" });

  return app;
}
