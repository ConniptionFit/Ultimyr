import { verify as verifyPassword } from "@node-rs/argon2";
import { generateSecret, generateURI, verifySync } from "otplib";
import { and, eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, type Ctx } from "../ctx.js";
import { passkeys, recoveryCodes, totpFactors, users } from "../schema.js";
import { parse } from "./core.js";

const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;

const codeBody = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6 digit code") });
const mfaVerifyBody = z.object({
  mfaToken: z.string().min(10),
  code: z.string().trim().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().trim().min(8).max(32).optional(),
});
const stepUpBody = z.object({
  password: z.string().max(128).optional(),
  code: z.string().trim().max(32).optional(),
});

export function mfaRoutes(ctx: Ctx) {
  const { db, secrets, limit } = ctx;
  const aad = (userId: string) => `totp:${userId}`;

  /** Verify a TOTP code with replay protection and brute-force lockout. */
  async function checkTotp(userId: string, code: string, requireConfirmed: boolean): Promise<boolean> {
    const [f] = await db.select().from(totpFactors).where(eq(totpFactors.userId, userId));
    if (!f || (requireConfirmed && !f.confirmedAt)) return false;
    if (f.lockedUntil && f.lockedUntil > new Date()) throw new HttpError(429, "mfa_locked");
    const secret = secrets.box.decrypt(f.secretEnc, aad(userId));
    const res = verifySync({
      secret,
      token: code,
      epochTolerance: 30,
      ...(f.lastTimeStep != null ? { afterTimeStep: f.lastTimeStep } : {}),
    });
    if (res.valid) {
      const timeStep = "timeStep" in res ? res.timeStep : Math.floor(Date.now() / 30_000) + res.delta;
      await db.update(totpFactors).set({ lastTimeStep: timeStep, failedAttempts: 0, lockedUntil: null }).where(eq(totpFactors.userId, userId));
      return true;
    }
    const failed = f.failedAttempts + 1;
    await db
      .update(totpFactors)
      .set({ failedAttempts: failed >= MAX_FAILURES ? 0 : failed, lockedUntil: failed >= MAX_FAILURES ? new Date(Date.now() + LOCK_MS) : null })
      .where(eq(totpFactors.userId, userId));
    return false;
  }

  async function useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const hash = secrets.hashToken(code.toLowerCase().replace(/\s/g, ""));
    const res = await db
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hash), sql`${recoveryCodes.usedAt} IS NULL`))
      .returning({ id: recoveryCodes.id });
    return res.length > 0;
  }

  async function issueRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const h = randomBytes(6).toString("hex");
      return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
    });
    await db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: secrets.hashToken(c) })));
    });
    return codes;
  }

  /** Step-up check for sensitive changes: current password, or a valid TOTP / recovery code. */
  async function stepUp(userId: string, body: z.infer<typeof stepUpBody>): Promise<void> {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (body.password && u?.passwordHash && (await verifyPassword(u.passwordHash, body.password).catch(() => false))) return;
    if (body.code) {
      if (/^\d{6}$/.test(body.code) && (await checkTotp(userId, body.code, true))) return;
      if (await useRecoveryCode(userId, body.code)) return;
    }
    throw new HttpError(403, "step_up_failed");
  }

  return async (r: FastifyInstance) => {
    r.get("/v1/me/mfa", async (req) => {
      const { user } = await ctx.authenticate(req);
      const [f] = await db.select().from(totpFactors).where(eq(totpFactors.userId, user.id));
      const codes = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(recoveryCodes)
        .where(and(eq(recoveryCodes.userId, user.id), sql`${recoveryCodes.usedAt} IS NULL`));
      const pk = await db.select({ n: sql<number>`count(*)::int` }).from(passkeys).where(eq(passkeys.userId, user.id));
      return {
        totp: { enabled: Boolean(f?.confirmedAt) },
        passkeys: pk[0]?.n ?? 0,
        recoveryCodesRemaining: codes[0]?.n ?? 0,
        hasPassword: Boolean(user.passwordHash),
      };
    });

    r.post("/v1/me/mfa/totp/setup", async (req) => {
      const { user } = await ctx.authenticate(req);
      const [existing] = await db.select().from(totpFactors).where(eq(totpFactors.userId, user.id));
      if (existing?.confirmedAt) throw new HttpError(409, "totp_already_enabled");
      const secret = generateSecret();
      const secretEnc = secrets.box.encrypt(secret, aad(user.id));
      await db
        .insert(totpFactors)
        .values({ userId: user.id, secretEnc })
        .onConflictDoUpdate({ target: totpFactors.userId, set: { secretEnc, lastTimeStep: null, failedAttempts: 0, lockedUntil: null } });
      const otpauthUri = generateURI({ issuer: "Ultimyr", label: user.email, secret });
      return { secret, otpauthUri };
    });

    r.post("/v1/me/mfa/totp/confirm", { config: limit }, async (req) => {
      const { user } = await ctx.authenticate(req);
      const { code } = parse(codeBody, req.body);
      if (!(await checkTotp(user.id, code, false))) throw new HttpError(400, "invalid_code");
      await db.update(totpFactors).set({ confirmedAt: new Date() }).where(eq(totpFactors.userId, user.id));
      const recoveryCodesList = await issueRecoveryCodes(user.id);
      await ctx.audit("mfa.totp_enabled", req, user.id);
      return { enabled: true, recoveryCodes: recoveryCodesList };
    });

    r.delete("/v1/me/mfa/totp", { config: limit }, async (req, reply) => {
      const { user } = await ctx.authenticate(req);
      await stepUp(user.id, parse(stepUpBody, req.body ?? {}));
      await db.delete(totpFactors).where(eq(totpFactors.userId, user.id));
      await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
      await ctx.audit("mfa.totp_disabled", req, user.id);
      return reply.code(204).send();
    });

    r.post("/v1/me/mfa/recovery-codes/regenerate", { config: limit }, async (req) => {
      const { user } = await ctx.authenticate(req);
      const [f] = await db.select().from(totpFactors).where(eq(totpFactors.userId, user.id));
      if (!f?.confirmedAt) throw new HttpError(409, "totp_not_enabled");
      await stepUp(user.id, parse(stepUpBody, req.body ?? {}));
      await ctx.audit("mfa.recovery_codes_regenerated", req, user.id);
      return { recoveryCodes: await issueRecoveryCodes(user.id) };
    });

    // Second step of a password login for accounts with TOTP enabled.
    r.post("/v1/auth/mfa/verify", { config: limit }, async (req, reply) => {
      const body = parse(mfaVerifyBody, req.body);
      const userId = await ctx.verifyMfaToken(body.mfaToken);
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user || user.status !== "active") throw new HttpError(401, "invalid_mfa_token");

      let amr: string[] | null = null;
      if (body.code && (await checkTotp(userId, body.code, true))) amr = ["pwd", "otp"];
      else if (body.recoveryCode && (await useRecoveryCode(userId, body.recoveryCode))) amr = ["pwd", "recovery"];
      if (!amr) {
        await ctx.audit("login.mfa_failed", req, userId);
        throw new HttpError(401, "invalid_code");
      }
      await ctx.audit("login.success", req, userId, null, { amr });
      return ctx.startSession(req, reply, userId, amr);
    });
  };
}
