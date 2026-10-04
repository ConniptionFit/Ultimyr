import { createHash, randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import formbody from "@fastify/formbody";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";

export interface Authorization {
  claims?: Record<string, unknown>;
  /** Misbehaviours for negative tests. */
  override?: { iss?: string; aud?: string; nonce?: string; expiresIn?: string; otherKey?: boolean; omitIdToken?: boolean };
}

interface Pending extends Authorization {
  clientId: string;
  challenge?: string | undefined;
  nonce?: string | undefined;
  redirectUri: string;
}

/** A tiny OIDC / OAuth2 identity provider for tests. */
export class MockIdp {
  readonly clientId = "ultimyr-client";
  readonly clientSecret = "s3cret-value";
  issuer = "";
  private app!: FastifyInstance;
  private key!: Awaited<ReturnType<typeof generateKeyPair>>;
  private otherKey!: Awaited<ReturnType<typeof generateKeyPair>>;
  private jwk!: JWK;
  private codes = new Map<string, Pending>();
  private tokens = new Map<string, Record<string, unknown>>();
  tokenRequests: Array<Record<string, string>> = [];

  async start() {
    this.key = await generateKeyPair("RS256");
    this.otherKey = await generateKeyPair("RS256");
    this.jwk = { ...(await exportJWK(this.key.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    this.app = Fastify();
    await this.app.register(formbody);
    this.app.get("/.well-known/openid-configuration", async () => ({
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      jwks_uri: `${this.issuer}/jwks`,
      userinfo_endpoint: `${this.issuer}/userinfo`,
    }));
    this.app.get("/jwks", async () => ({ keys: [this.jwk] }));
    this.app.post("/token", async (req, reply) => {
      const b = req.body as Record<string, string>;
      this.tokenRequests.push(b);
      const basic = req.headers.authorization?.startsWith("Basic ")
        ? Buffer.from(req.headers.authorization.slice(6), "base64").toString().split(":").map(decodeURIComponent)
        : null;
      const clientId = basic?.[0] ?? b.client_id;
      const secret = basic?.[1] ?? b.client_secret;
      const p = this.codes.get(b.code ?? "");
      this.codes.delete(b.code ?? ""); // codes are single use
      if (!p || clientId !== this.clientId || secret !== this.clientSecret || b.redirect_uri !== p.redirectUri) return reply.code(400).send({ error: "invalid_grant" });
      if (p.challenge && createHash("sha256").update(b.code_verifier ?? "").digest("base64url") !== p.challenge) return reply.code(400).send({ error: "invalid_grant" });
      const access = randomBytes(16).toString("hex");
      const claims = p.claims ?? {};
      this.tokens.set(access, claims);
      const o = p.override ?? {};
      const out: Record<string, unknown> = { access_token: access, token_type: "Bearer" };
      if (!o.omitIdToken) {
        out.id_token = await new SignJWT({ ...claims, ...(p.nonce !== undefined || o.nonce ? { nonce: o.nonce ?? p.nonce } : {}) })
          .setProtectedHeader({ alg: "RS256", kid: "k1" })
          .setIssuer(o.iss ?? this.issuer)
          .setAudience(o.aud ?? p.clientId)
          .setIssuedAt()
          .setExpirationTime(o.expiresIn ?? "5m")
          .sign(o.otherKey ? this.otherKey.privateKey : this.key.privateKey);
      }
      return out;
    });
    this.app.get("/userinfo", async (req, reply) => {
      const claims = this.tokens.get(req.headers.authorization?.slice(7) ?? "");
      return claims ?? reply.code(401).send({ error: "invalid_token" });
    });
    await this.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = this.app.server.address();
    this.issuer = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    return this;
  }

  /** "The user logs in at the IdP": turn the authorization URL into a code the callback can redeem. */
  authorize(location: string, a: Authorization = {}): { code: string; state: string } {
    const u = new URL(location);
    const code = randomBytes(12).toString("hex");
    this.codes.set(code, {
      ...a,
      clientId: u.searchParams.get("client_id") ?? "",
      challenge: u.searchParams.get("code_challenge") ?? undefined,
      nonce: u.searchParams.get("nonce") ?? undefined,
      redirectUri: u.searchParams.get("redirect_uri") ?? "",
    });
    return { code, state: u.searchParams.get("state") ?? "" };
  }

  stop() {
    return this.app.close();
  }
}
