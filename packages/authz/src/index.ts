import { createRemoteJWKSet, jwtVerify, type CryptoKey, type JWTVerifyGetKey, type KeyObject } from "jose";
import { z } from "zod";

export const ROLES = ["platform_admin", "org_admin", "author", "learner"] as const;
export type Role = (typeof ROLES)[number];

export const ISSUER = "ultimyr-auth";
export const AUDIENCE = "ultimyr";

export const accessClaimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  roles: z.array(z.enum(ROLES)),
  scopes: z.array(z.string()).default([]),
});
export type AccessClaims = z.infer<typeof accessClaimsSchema>;

export interface Principal {
  userId: string;
  sessionId: string;
  roles: Role[];
  scopes: string[];
}

export type KeySource = JWTVerifyGetKey | CryptoKey | KeyObject | Uint8Array;

/** Verify against a JWKS URL (what every non-auth service does). */
export function remoteKeySource(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 10_000 });
}

export async function verifyAccessToken(token: string, key: KeySource): Promise<Principal> {
  const opts = { issuer: ISSUER, audience: AUDIENCE, algorithms: ["EdDSA"] };
  const { payload } =
    typeof key === "function" ? await jwtVerify(token, key, opts) : await jwtVerify(token, key as CryptoKey, opts);
  const claims = accessClaimsSchema.parse(payload);
  return { userId: claims.sub, sessionId: claims.sid, roles: claims.roles, scopes: claims.scopes };
}

export function hasRole(p: Principal, ...roles: Role[]): boolean {
  return roles.some((r) => p.roles.includes(r));
}

/** Token scopes cap what a principal may do, even for admins. Empty scopes means a full interactive session. */
export function hasScope(p: Principal, scope: string): boolean {
  return p.scopes.length === 0 || p.scopes.includes(scope);
}
