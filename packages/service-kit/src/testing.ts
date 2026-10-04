import { AUDIENCE, ISSUER, type Role } from "@ultimyr/authz";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { uuidv7 } from "./index.js";

/** A throwaway token issuer for service tests: signs tokens the same way the auth service does. */
export function createTestIssuer() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  async function token(opts: { userId?: string; roles?: Role[]; scopes?: string[]; sessionId?: string; ttl?: number } = {}) {
    return new SignJWT({ sid: opts.sessionId ?? "test-session", roles: opts.roles ?? ["author", "learner"], scopes: opts.scopes ?? [], amr: ["pwd"] })
      .setProtectedHeader({ alg: "EdDSA" })
      .setSubject(opts.userId ?? uuidv7())
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${opts.ttl ?? 600}s`)
      .sign(privateKey as KeyObject);
  }
  return { publicKey: publicKey as KeyObject, token, bearer: async (o?: Parameters<typeof token>[0]) => ({ authorization: `Bearer ${await token(o)}` }) };
}
