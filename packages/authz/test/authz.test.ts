import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { AUDIENCE, ISSUER, hasRole, hasScope, verifyAccessToken } from "../src/index.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");

const sign = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string; key?: typeof privateKey } = {}) =>
  new SignJWT({ sid: "s1", roles: ["learner"], scopes: [], ...claims })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject("u1")
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? "5m")
    .sign(opts.key ?? privateKey);

describe("verifyAccessToken", () => {
  it("accepts a valid token", async () => {
    const p = await verifyAccessToken(await sign({}), publicKey);
    expect(p).toEqual({ userId: "u1", sessionId: "s1", roles: ["learner"], scopes: [] });
  });
  it("rejects wrong key, audience, issuer, expiry and unknown roles", async () => {
    await expect(verifyAccessToken(await sign({}, { key: other.privateKey }), publicKey)).rejects.toThrow();
    await expect(verifyAccessToken(await sign({}, { aud: "someone-else" }), publicKey)).rejects.toThrow();
    await expect(verifyAccessToken(await sign({}, { iss: "evil" }), publicKey)).rejects.toThrow();
    await expect(verifyAccessToken(await sign({}, { exp: "-1m" }), publicKey)).rejects.toThrow();
    await expect(verifyAccessToken(await sign({ roles: ["root"] }), publicKey)).rejects.toThrow();
  });
});

describe("role and scope helpers", () => {
  const p = { userId: "u", sessionId: "s", roles: ["author" as const], scopes: ["content:read"] };
  it("checks roles", () => {
    expect(hasRole(p, "author")).toBe(true);
    expect(hasRole(p, "platform_admin")).toBe(false);
  });
  it("scopes cap even privileged tokens; empty scopes means a full session", () => {
    expect(hasScope(p, "content:read")).toBe(true);
    expect(hasScope(p, "content:write")).toBe(false);
    expect(hasScope({ ...p, scopes: [] }, "content:write")).toBe(true);
  });
});
