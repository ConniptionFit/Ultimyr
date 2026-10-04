import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError, type Ctx } from "../ctx.js";
import { uuidv7 } from "../ids.js";
import { passkeys, users, webauthnChallenges } from "../schema.js";
import { parse } from "./core.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const registerVerifyBody = z.object({
  challengeId: z.uuid(),
  name: z.string().trim().min(1).max(60).default("Passkey"),
  response: z.record(z.string(), z.unknown()),
});
const loginVerifyBody = z.object({ challengeId: z.uuid(), response: z.record(z.string(), z.unknown()) });

export function passkeyRoutes(ctx: Ctx) {
  const { db, config, limit } = ctx;
  const rpID = new URL(config.publicUrl).hostname;
  const origin = new URL(config.publicUrl).origin;

  async function newChallenge(purpose: "register" | "login", challenge: string, userId: string | null) {
    const id = uuidv7();
    // Opportunistic cleanup keeps the table small without a scheduler.
    await db.delete(webauthnChallenges).where(sql`${webauthnChallenges.expiresAt} < now()`);
    await db.insert(webauthnChallenges).values({ id, purpose, challenge, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
    return id;
  }

  /** Challenges are single use: fetch and delete atomically. */
  async function consumeChallenge(id: string, purpose: "register" | "login", userId: string | null) {
    const [c] = await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, id)).returning();
    if (!c || c.purpose !== purpose || c.expiresAt < new Date() || (userId && c.userId !== userId)) {
      throw new HttpError(400, "invalid_challenge");
    }
    return c.challenge;
  }

  return async (r: FastifyInstance) => {
    r.get("/v1/me/passkeys", async (req) => {
      const { user } = await ctx.authenticate(req);
      const rows = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
      return rows.map((p) => ({ id: p.id, name: p.name, backedUp: p.backedUp, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt }));
    });

    r.post("/v1/me/passkeys/register/options", async (req) => {
      const { user } = await ctx.authenticate(req);
      const existing = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
      const options = await generateRegistrationOptions({
        rpName: "Ultimyr",
        rpID,
        userName: user.email,
        userDisplayName: user.displayName,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        excludeCredentials: existing.map((p) => ({ id: p.credentialId, ...(p.transports ? { transports: p.transports } : {}) })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      });
      return { challengeId: await newChallenge("register", options.challenge, user.id), options };
    });

    r.post("/v1/me/passkeys/register/verify", { config: limit }, async (req) => {
      const { user } = await ctx.authenticate(req);
      const body = parse(registerVerifyBody, req.body);
      const expectedChallenge = await consumeChallenge(body.challengeId, "register", user.id);
      const verification = await verifyRegistrationResponse({
        response: body.response as never,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      }).catch(() => null);
      if (!verification?.verified) throw new HttpError(400, "verification_failed");
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      const id = uuidv7();
      try {
        await db.insert(passkeys).values({
          id,
          userId: user.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports ?? null,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          name: body.name,
        });
      } catch {
        throw new HttpError(409, "credential_exists");
      }
      await ctx.audit("passkey.registered", req, user.id, id);
      return { id, name: body.name };
    });

    r.delete("/v1/me/passkeys/:id", async (req, reply) => {
      const { user } = await ctx.authenticate(req);
      const { id } = req.params as { id: string };
      const mine = await db.select().from(passkeys).where(eq(passkeys.userId, user.id));
      const target = mine.find((p) => p.id === id);
      if (!target) throw new HttpError(404, "not_found");
      // Never remove the last way to sign in.
      if (mine.length === 1 && !user.passwordHash) throw new HttpError(409, "last_sign_in_method");
      await db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, user.id)));
      await ctx.audit("passkey.removed", req, user.id, id);
      return reply.code(204).send();
    });

    // Passwordless sign-in. User verification is required, so a passkey login is already multi-factor.
    r.post("/v1/auth/passkeys/login/options", { config: limit }, async () => {
      const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
      return { challengeId: await newChallenge("login", options.challenge, null), options };
    });

    r.post("/v1/auth/passkeys/login/verify", { config: limit }, async (req, reply) => {
      const body = parse(loginVerifyBody, req.body);
      const expectedChallenge = await consumeChallenge(body.challengeId, "login", null);
      const credentialId = typeof body.response.id === "string" ? body.response.id : "";
      const [pk] = await db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId));
      if (!pk) throw new HttpError(401, "invalid_credentials");
      const [user] = await db.select().from(users).where(eq(users.id, pk.userId));
      if (!user || user.status !== "active") throw new HttpError(401, "invalid_credentials");

      const verification = await verifyAuthenticationResponse({
        response: body.response as never,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: pk.credentialId,
          publicKey: new Uint8Array(pk.publicKey),
          counter: pk.counter,
          ...(pk.transports ? { transports: pk.transports } : {}),
        },
      }).catch(() => null);
      if (!verification?.verified) {
        await ctx.audit("login.passkey_failed", req, user.id);
        throw new HttpError(401, "invalid_credentials");
      }
      await db
        .update(passkeys)
        .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date(), backedUp: verification.authenticationInfo.credentialBackedUp })
        .where(eq(passkeys.id, pk.id));
      await ctx.audit("login.success", req, user.id, null, { amr: ["webauthn"] });
      return ctx.startSession(req, reply, user.id, ["webauthn"]);
    });
  };
}
