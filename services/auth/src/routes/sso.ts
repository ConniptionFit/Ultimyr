import { createHash, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { HttpError, type Ctx } from "../ctx.js";
import { uuidv7 } from "../ids.js";
import { identities, idpProviders, ssoStates } from "../schema.js";
import { randomToken } from "../secrets.js";
import { assertIdpUrl, fetchJson, safeNext } from "../sso/http.js";
import { SsoError, resolveSsoUser, type ExternalProfile, type Provider } from "../sso/users.js";
import { parse } from "./core.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const ID_TOKEN_ALGS = ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384", "EdDSA"];

export const oidcConfig = z.object({
  issuer: z.string().url(),
  clientId: z.string().min(1),
  scopes: z.array(z.string()).default(["openid", "email", "profile"]),
  tokenAuthMethod: z.enum(["post", "basic"]).default("post"),
});
export const oauth2Config = z.object({
  authorizeUrl: z.string().url(),
  tokenUrl: z.string().url(),
  userinfoUrl: z.string().url(),
  clientId: z.string().min(1),
  scopes: z.array(z.string()).default([]),
  tokenAuthMethod: z.enum(["post", "basic"]).default("post"),
  subjectField: z.string().default("id"),
  emailField: z.string().default("email"),
  emailVerifiedField: z.string().optional(),
  nameField: z.string().default("name"),
  groupsField: z.string().optional(),
});
export const samlConfig = z.object({
  entryPoint: z.string().url(),
  idpCert: z.string().min(20),
  idpIssuer: z.string().optional(),
  spEntityId: z.string().optional(),
  emailAttr: z.string().default("email"),
  nameAttr: z.string().default("displayName"),
  groupsAttr: z.string().optional(),
});

const providerBase = {
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/, "lowercase letters, digits and dashes"),
  name: z.string().trim().min(1).max(60),
  jitProvisioning: z.boolean().default(true),
  trustEmail: z.boolean().default(false),
  groupClaim: z.string().max(100).optional(),
  enabled: z.boolean().default(true),
  clientSecret: z.string().min(1).max(2000).optional(),
};
const createProviderBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("oidc"), config: oidcConfig, ...providerBase }),
  z.object({ kind: z.literal("oauth2"), config: oauth2Config, ...providerBase }),
  z.object({ kind: z.literal("saml"), config: samlConfig, ...providerBase }),
]);
const patchProviderBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  enabled: z.boolean().optional(),
  jitProvisioning: z.boolean().optional(),
  trustEmail: z.boolean().optional(),
  groupClaim: z.string().max(100).nullable().optional(),
  clientSecret: z.string().min(1).max(2000).optional(),
});

const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const getPath = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
const asStringList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : undefined);
const asBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : typeof v === "string" ? v === "true" : undefined);

export function ssoRoutes(ctx: Ctx) {
  const { db, config, secrets } = ctx;
  const insecure = config.allowInsecureIdp;
  const redirectUri = (slug: string) => `${config.publicUrl}/api/v1/auth/sso/${slug}/callback`;

  const discoveryCache = new Map<string, { at: number; doc: Record<string, unknown> }>();
  const jwksCache = new Map<string, JWTVerifyGetKey>();

  async function discover(issuer: string) {
    const hit = discoveryCache.get(issuer);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.doc;
    assertIdpUrl(issuer, insecure);
    const doc = await fetchJson(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
    if (doc.issuer !== issuer && doc.issuer !== issuer.replace(/\/$/, "")) throw new SsoError("issuer_mismatch");
    for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) assertIdpUrl(String(doc[k] ?? ""), insecure);
    discoveryCache.set(issuer, { at: Date.now(), doc });
    return doc;
  }

  const jwksFor = (uri: string) => {
    let j = jwksCache.get(uri);
    if (!j) jwksCache.set(uri, (j = createRemoteJWKSet(new URL(uri), { timeoutDuration: 10_000 })));
    return j;
  };

  const clientSecretOf = (p: Provider): string | undefined =>
    p.clientSecretEnc ? secrets.box.decrypt(p.clientSecretEnc, `idp:${p.id}`) : undefined;

  async function exchangeCode(p: Provider, tokenUrl: string, cfg: { clientId: string; tokenAuthMethod: "post" | "basic" }, code: string, verifier: string | null, slug: string) {
    const secret = clientSecretOf(p);
    const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(slug) });
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (verifier) form.set("code_verifier", verifier);
    if (cfg.tokenAuthMethod === "basic" && secret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(secret)}`).toString("base64")}`;
    else {
      form.set("client_id", cfg.clientId);
      if (secret) form.set("client_secret", secret);
    }
    return fetchJson(tokenUrl, { method: "POST", headers, body: form });
  }

  async function loginRedirect(reply: FastifyReply, error: string) {
    return reply.redirect(`${config.publicUrl}/login?error=${encodeURIComponent(error)}`, 302);
  }

  async function finish(req: FastifyRequest, reply: FastifyReply, p: Provider, ext: ExternalProfile, next: string | null) {
    const userId = await resolveSsoUser(ctx, p, ext);
    await ctx.audit("login.sso", req, userId, p.slug);
    await ctx.startSession(req, reply, userId, ["sso"]);
    return reply.redirect(`${config.publicUrl}${safeNext(next)}`, 302);
  }

  async function takeState(state: string, providerId: string) {
    const [s] = await db.delete(ssoStates).where(and(eq(ssoStates.state, state), eq(ssoStates.providerId, providerId))).returning();
    if (!s || s.expiresAt < new Date()) throw new SsoError("invalid_state");
    return s;
  }

  async function newState(p: Provider, extra: { nonce?: string; verifier?: string; next: string }) {
    const state = randomToken(24);
    await db.delete(ssoStates).where(sql`${ssoStates.expiresAt} < now()`);
    await db.insert(ssoStates).values({ state, providerId: p.id, nonce: extra.nonce ?? null, codeVerifier: extra.verifier ?? null, redirectTo: extra.next, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
    return state;
  }

  async function loadProvider(slug: string, kinds: string[]): Promise<Provider> {
    const [p] = await db.select().from(idpProviders).where(eq(idpProviders.slug, slug));
    if (!p || !p.enabled || !kinds.includes(p.kind)) throw new HttpError(404, "provider_not_found");
    return p;
  }

  return async (r: FastifyInstance) => {
    // ---- public --------------------------------------------------------------
    r.get("/v1/auth/sso/providers", async () => {
      const rows = await db.select({ slug: idpProviders.slug, name: idpProviders.name, kind: idpProviders.kind }).from(idpProviders).where(eq(idpProviders.enabled, true)).orderBy(idpProviders.name);
      return rows.map((p) => ({ ...p, startUrl: `/api/v1/auth/${p.kind === "saml" ? "saml" : "sso"}/${p.slug}/start` }));
    });

    r.get("/v1/auth/sso/:slug/start", { config: ctx.limit }, async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const p = await loadProvider(slug, ["oidc", "oauth2"]);
      const next = safeNext((req.query as { next?: string }).next);
      const verifier = randomToken(48);
      const nonce = randomToken(16);

      let authorizeUrl: string;
      let params: Record<string, string>;
      if (p.kind === "oidc") {
        const cfg = oidcConfig.parse(p.config);
        const doc = await discover(cfg.issuer);
        authorizeUrl = String(doc.authorization_endpoint);
        params = { response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri(slug), scope: cfg.scopes.join(" "), nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256" };
      } else {
        const cfg = oauth2Config.parse(p.config);
        authorizeUrl = assertIdpUrl(cfg.authorizeUrl, insecure).toString();
        params = { response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri(slug), ...(cfg.scopes.length ? { scope: cfg.scopes.join(" ") } : {}), code_challenge: pkceChallenge(verifier), code_challenge_method: "S256" };
      }
      params.state = await newState(p, { nonce, verifier, next });
      const url = new URL(authorizeUrl);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return reply.redirect(url.toString(), 302);
    });

    r.get("/v1/auth/sso/:slug/callback", { config: ctx.limit }, async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const q = req.query as { code?: string; state?: string; error?: string };
      try {
        const p = await loadProvider(slug, ["oidc", "oauth2"]);
        if (q.error) throw new SsoError("idp_error");
        if (!q.code || !q.state) throw new SsoError("invalid_request");
        const st = await takeState(q.state, p.id);
        const ext = p.kind === "oidc" ? await oidcProfile(p, slug, q.code, st) : await oauth2Profile(p, slug, q.code, st);
        return await finish(req, reply, p, ext, st.redirectTo);
      } catch (err) {
        const code = err instanceof SsoError ? err.code : err instanceof HttpError ? err.code : "sso_failed";
        if (!(err instanceof SsoError)) req.log.warn({ err: String(err) }, "sso callback failed");
        await ctx.audit("login.sso_failed", req, null, slug, { code });
        return loginRedirect(reply, code);
      }
    });

    async function oidcProfile(p: Provider, slug: string, code: string, st: { nonce: string | null; codeVerifier: string | null }): Promise<ExternalProfile> {
      const cfg = oidcConfig.parse(p.config);
      const doc = await discover(cfg.issuer);
      const tokens = await exchangeCode(p, String(doc.token_endpoint), cfg, code, st.codeVerifier, slug);
      if (typeof tokens.id_token !== "string") throw new SsoError("missing_id_token");
      const { payload } = await jwtVerify(tokens.id_token, jwksFor(String(doc.jwks_uri)), {
        issuer: String(doc.issuer),
        audience: cfg.clientId,
        algorithms: ID_TOKEN_ALGS,
        clockTolerance: 30,
      }).catch(() => {
        throw new SsoError("invalid_id_token");
      });
      if (!st.nonce || payload.nonce !== st.nonce) throw new SsoError("invalid_nonce");
      if (typeof payload.sub !== "string" || !payload.sub) throw new SsoError("invalid_id_token");

      let claims: Record<string, unknown> = payload;
      // Some IdPs keep email and groups in userinfo rather than the ID token.
      if ((!claims.email || (p.groupClaim && claims[p.groupClaim] === undefined)) && typeof doc.userinfo_endpoint === "string" && typeof tokens.access_token === "string") {
        assertIdpUrl(doc.userinfo_endpoint, insecure);
        const info: Record<string, unknown> = await fetchJson(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } }).catch(() => ({}));
        if (info.sub === payload.sub) claims = { ...info, ...payload };
      }
      return {
        subject: payload.sub,
        email: typeof claims.email === "string" ? claims.email : undefined,
        emailVerified: asBool(claims.email_verified),
        name: typeof claims.name === "string" ? claims.name : typeof claims.preferred_username === "string" ? claims.preferred_username : undefined,
        groups: p.groupClaim ? asStringList(getPath(claims, p.groupClaim)) : undefined,
        claims: { sub: payload.sub, iss: payload.iss, email: claims.email },
      };
    }

    async function oauth2Profile(p: Provider, slug: string, code: string, st: { codeVerifier: string | null }): Promise<ExternalProfile> {
      const cfg = oauth2Config.parse(p.config);
      const tokens = await exchangeCode(p, assertIdpUrl(cfg.tokenUrl, insecure).toString(), cfg, code, st.codeVerifier, slug);
      if (typeof tokens.access_token !== "string") throw new SsoError("missing_access_token");
      const info = await fetchJson(assertIdpUrl(cfg.userinfoUrl, insecure).toString(), { headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" } });
      const subject = getPath(info, cfg.subjectField);
      if (subject === undefined || subject === null || subject === "") throw new SsoError("missing_subject");
      const email = getPath(info, cfg.emailField);
      const name = getPath(info, cfg.nameField);
      return {
        subject: String(subject),
        email: typeof email === "string" ? email : undefined,
        emailVerified: cfg.emailVerifiedField ? asBool(getPath(info, cfg.emailVerifiedField)) : undefined,
        name: typeof name === "string" ? name : undefined,
        groups: cfg.groupsField ? asStringList(getPath(info, cfg.groupsField)) : undefined,
        claims: { sub: String(subject) },
      };
    }

    // ---- admin: providers -----------------------------------------------------
    const view = (p: Provider) => ({
      id: p.id,
      slug: p.slug,
      kind: p.kind,
      name: p.name,
      config: p.config,
      hasClientSecret: Boolean(p.clientSecretEnc),
      jitProvisioning: p.jitProvisioning,
      trustEmail: p.trustEmail,
      groupClaim: p.groupClaim,
      enabled: p.enabled,
      redirectUri: p.kind === "saml" ? `${config.publicUrl}/api/v1/auth/saml/${p.slug}/acs` : redirectUri(p.slug),
      ...(p.kind === "saml" ? { metadataUrl: `${config.publicUrl}/api/v1/auth/saml/${p.slug}/metadata` } : {}),
    });

    r.get("/v1/admin/idp-providers", async (req) => {
      await ctx.requireAdmin(req);
      return (await db.select().from(idpProviders).orderBy(idpProviders.name)).map(view);
    });

    r.post("/v1/admin/idp-providers", async (req, reply) => {
      const { user } = await ctx.requireAdmin(req);
      const body = parse(createProviderBody, req.body);
      const urls = body.kind === "oidc" ? [body.config.issuer] : body.kind === "oauth2" ? [body.config.authorizeUrl, body.config.tokenUrl, body.config.userinfoUrl] : [body.config.entryPoint];
      urls.forEach((u) => assertIdpUrl(u, insecure));
      const id = uuidv7();
      try {
        await db.insert(idpProviders).values({
          id,
          slug: body.slug,
          kind: body.kind,
          name: body.name,
          config: body.config,
          clientSecretEnc: body.clientSecret ? secrets.box.encrypt(body.clientSecret, `idp:${id}`) : null,
          jitProvisioning: body.jitProvisioning,
          trustEmail: body.trustEmail,
          groupClaim: body.groupClaim ?? null,
          enabled: body.enabled,
        });
      } catch {
        throw new HttpError(409, "slug_taken");
      }
      await ctx.audit("admin.idp_created", req, user.id, id, { slug: body.slug, kind: body.kind });
      const [p] = await db.select().from(idpProviders).where(eq(idpProviders.id, id));
      return reply.code(201).send(view(p!));
    });

    r.patch("/v1/admin/idp-providers/:id", async (req) => {
      const { user } = await ctx.requireAdmin(req);
      const { id } = req.params as { id: string };
      const body = parse(patchProviderBody, req.body);
      const [p] = await db.select().from(idpProviders).where(eq(idpProviders.id, id)).catch(() => []);
      if (!p) throw new HttpError(404, "not_found");
      await db
        .update(idpProviders)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.jitProvisioning !== undefined ? { jitProvisioning: body.jitProvisioning } : {}),
          ...(body.trustEmail !== undefined ? { trustEmail: body.trustEmail } : {}),
          ...(body.groupClaim !== undefined ? { groupClaim: body.groupClaim } : {}),
          ...(body.clientSecret ? { clientSecretEnc: secrets.box.encrypt(body.clientSecret, `idp:${id}`) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(idpProviders.id, id));
      await ctx.audit("admin.idp_updated", req, user.id, id);
      const [u] = await db.select().from(idpProviders).where(eq(idpProviders.id, id));
      return view(u!);
    });

    r.delete("/v1/admin/idp-providers/:id", async (req, reply) => {
      const { user } = await ctx.requireAdmin(req);
      const { id } = req.params as { id: string };
      const res = await db.delete(idpProviders).where(eq(idpProviders.id, id)).returning({ id: idpProviders.id }).catch(() => []);
      if (!res.length) throw new HttpError(404, "not_found");
      await ctx.audit("admin.idp_deleted", req, user.id, id);
      return reply.code(204).send();
    });

    // Linked sign-in methods for the current user.
    r.get("/v1/me/identities", async (req) => {
      const { user } = await ctx.authenticateInteractive(req);
      return db
        .select({ id: identities.id, provider: idpProviders.name, email: identities.email, lastLoginAt: identities.lastLoginAt })
        .from(identities)
        .innerJoin(idpProviders, eq(idpProviders.id, identities.providerId))
        .where(eq(identities.userId, user.id));
    });
  };
}
