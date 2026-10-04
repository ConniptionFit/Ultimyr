import { hash, verify } from "@node-rs/argon2";
import type { Role } from "@ultimyr/authz";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACCESS_TTL_SECONDS, HttpError, REFRESH_COOKIE, type Ctx } from "../ctx.js";
import { uuidv7 } from "../ids.js";
import { passwordTokens, roleAssignments, sessions, totpFactors, users } from "../schema.js";
import { randomToken, safeEqual, sha256Hex } from "../secrets.js";

const registerBody = z.object({
  email: z.email().max(254),
  password: z.string().min(12, "Password must be at least 12 characters").max(128),
  displayName: z.string().trim().min(1).max(80),
});
const newPassword = z.string().min(12, "Password must be at least 12 characters").max(128);
const setPasswordBody = z.object({ token: z.string().min(10).max(200), password: newPassword });
const changePasswordBody = z.object({ changeToken: z.string().min(10).max(2000), currentPassword: z.string().min(1).max(128), newPassword });
const loginBody = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) });

export const parse = <S extends z.ZodType>(schema: S, body: unknown): z.infer<S> => {
  const r = schema.safeParse(body);
  if (!r.success) throw Object.assign(new Error("invalid_request"), { validation: r.error.issues.map((i) => i.message) });
  return r.data;
};

export function coreRoutes(ctx: Ctx) {
  const { db, config, keys, limit, refreshLimit } = ctx;

  return async (r: FastifyInstance) => {
    // Burn a hash on unknown emails so login timing does not reveal which accounts exist.
    const dummyHash = await hash("ultimyr-dummy-password");

    r.get("/healthz", async () => ({ status: "ok" }));
    r.get("/readyz", async (_req, reply) => {
      try {
        await ctx.pool.query("SELECT 1");
        return { status: "ready" };
      } catch {
        return reply.code(503).send({ status: "unavailable" });
      }
    });

    r.get("/.well-known/jwks.json", async (_req, reply) => {
      reply.header("cache-control", "public, max-age=300");
      return { keys: [keys.publicJwk] };
    });

    r.post("/v1/auth/register", { config: limit }, async (req, reply) => {
      const { email, password, displayName } = parse(registerBody, req.body);
      const passwordHash = await hash(password);
      const userId = uuidv7();

      const registrationOpen = await ctx.registrationOpen();
      const localDisabled = await ctx.localUsersDisabled();
      const result = await db.transaction(async (tx) => {
        // Serialise first-user detection so two simultaneous sign-ups cannot both become admin.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('ultimyr_first_user'))`);
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
        const first = n === 0;
        if (!first && localDisabled) return "local_disabled" as const;
        if (!first && !registrationOpen) return "closed" as const;
        const exists = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = lower(${email})`);
        if (exists.length) return "exists" as const;
        await tx.insert(users).values({ id: userId, email, displayName, passwordHash });
        const roles: Role[] = first ? ["platform_admin", "org_admin", "author", "learner"] : ["author", "learner"];
        await tx.insert(roleAssignments).values(roles.map((role) => ({ userId, role })));
        return first ? ("first" as const) : ("ok" as const);
      });

      if (result === "local_disabled") return reply.code(403).send({ error: "local_users_disabled" });
      if (result === "closed") return reply.code(403).send({ error: "registration_closed" });
      if (result === "exists") return reply.code(409).send({ error: "email_taken" });

      await ctx.audit(result === "first" ? "user.bootstrap_admin" : "user.register", req, userId, userId);
      return reply.code(201).send(await ctx.startSession(req, reply, userId, ["pwd"]));
    });

    r.post("/v1/auth/login", { config: limit }, async (req, reply) => {
      const { email, password } = parse(loginBody, req.body);
      const [user] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);

      const ok = await verify(user?.passwordHash ?? dummyHash, password).catch(() => false);
      if (!user || !user.passwordHash || !ok || user.status !== "active") {
        await ctx.audit("login.failed", req, user?.id);
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      if (await ctx.localSignInBlocked(user, await ctx.rolesFor(user.id))) {
        await ctx.audit("login.local_disabled", req, user.id);
        return reply.code(403).send({ error: "local_users_disabled" });
      }
      // Admin-created accounts with a temporary password must choose their own before getting a session.
      if (user.mustChangePassword) {
        await ctx.audit("login.password_change_required", req, user.id);
        return { passwordChangeRequired: true, changeToken: await ctx.signPasswordChangeToken(user.id) };
      }

      const [totp] = await db.select({ at: totpFactors.confirmedAt }).from(totpFactors).where(eq(totpFactors.userId, user.id));
      if (totp?.at) {
        await ctx.audit("login.mfa_required", req, user.id);
        return { mfaRequired: true, mfaToken: await ctx.signMfaToken(user.id), methods: ["totp", "recovery"] };
      }
      await ctx.audit("login.success", req, user.id);
      return ctx.startSession(req, reply, user.id, ["pwd"]);
    });

    // Second step for a temporary password: verify it again, store the new one, then sign in.
    r.post("/v1/auth/change-password", { config: limit }, async (req, reply) => {
      const body = parse(changePasswordBody, req.body);
      const userId = await ctx.verifyPasswordChangeToken(body.changeToken);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.status !== "active" || !user.mustChangePassword || !user.passwordHash) throw new HttpError(401, "invalid_change_token");
      if (!(await verify(user.passwordHash, body.currentPassword).catch(() => false))) {
        await ctx.audit("login.failed", req, userId);
        throw new HttpError(401, "invalid_credentials");
      }
      if (body.currentPassword === body.newPassword) throw new HttpError(400, "password_unchanged");
      await db.update(users).set({ passwordHash: await hash(body.newPassword), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, userId));
      await ctx.audit("user.password_changed", req, userId, userId, { via: "first_sign_in" });
      return ctx.startSession(req, reply, userId, ["pwd"]);
    });

    // Redeem a one-time invite or reset link created by an administrator.
    r.post("/v1/auth/set-password", { config: limit }, async (req, reply) => {
      const body = parse(setPasswordBody, req.body);
      const [used] = await db
        .update(passwordTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordTokens.tokenHash, ctx.secrets.hashToken(body.token)), sql`${passwordTokens.usedAt} IS NULL`, sql`${passwordTokens.expiresAt} > now()`))
        .returning({ userId: passwordTokens.userId });
      if (!used) throw new HttpError(400, "invalid_token");
      const [user] = await db.select().from(users).where(eq(users.id, used.userId));
      if (!user || user.status !== "active") throw new HttpError(400, "invalid_token");
      await db.update(users).set({ passwordHash: await hash(body.password), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, user.id));
      await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), sql`${sessions.revokedAt} IS NULL`));
      await ctx.audit("user.password_set", req, user.id, user.id, { via: "invite" });
      return ctx.startSession(req, reply, user.id, ["pwd"]);
    });

    // Rotating refresh tokens with reuse detection.
    r.post("/v1/auth/refresh", { config: refreshLimit }, async (req, reply) => {
      const raw = req.cookies[REFRESH_COOKIE];
      const [sessionId, secret] = raw?.split(".") ?? [];
      const fail = () => {
        ctx.clearRefreshCookie(reply);
        return reply.code(401).send({ error: "invalid_session" });
      };
      if (!sessionId || !secret) return fail();

      const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).catch(() => []);
      if (!s || s.revokedAt || s.expiresAt < new Date()) return fail();

      const presented = sha256Hex(secret);
      if (safeEqual(presented, s.refreshHash)) {
        const next = randomToken();
        await db
          .update(sessions)
          .set({ refreshHash: sha256Hex(next), prevRefreshHash: s.refreshHash, lastSeenAt: new Date() })
          .where(eq(sessions.id, s.id));
        const [user] = await db.select().from(users).where(eq(users.id, s.userId));
        if (!user || user.status !== "active" || (await ctx.localSignInBlocked(user, await ctx.rolesFor(user.id)))) return fail();
        ctx.setRefreshCookie(reply, s.id, next);
        const roles = await ctx.rolesFor(user.id);
        return {
          accessToken: await ctx.signAccess({ userId: user.id, sessionId: s.id, roles, amr: s.amr }),
          expiresIn: ACCESS_TTL_SECONDS,
          user: ctx.publicUser(user, roles),
        };
      }
      if (s.prevRefreshHash && safeEqual(presented, s.prevRefreshHash)) {
        // A rotated-out token came back: assume theft and kill the whole session.
        await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, s.id));
        await ctx.audit("session.reuse_detected", req, s.userId, s.id);
      }
      return fail();
    });

    r.post("/v1/auth/logout", async (req, reply) => {
      const [sessionId] = req.cookies[REFRESH_COOKIE]?.split(".") ?? [];
      if (sessionId) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.id, sessionId), sql`${sessions.revokedAt} IS NULL`))
          .catch(() => undefined);
      }
      ctx.clearRefreshCookie(reply);
      return reply.code(204).send();
    });

    r.get("/v1/me", async (req) => {
      const { user } = await ctx.authenticate(req);
      return ctx.publicUser(user, await ctx.rolesFor(user.id));
    });
  };
}
