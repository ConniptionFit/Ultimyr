import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from "@node-saml/node-saml";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { HttpError, type Ctx } from "../ctx.js";
import { idpProviders, ssoStates } from "../schema.js";
import { randomToken } from "../secrets.js";
import { assertIdpUrl, safeNext } from "../sso/http.js";
import { SsoError, resolveSsoUser, type ExternalProfile, type Provider } from "../sso/users.js";
import { samlConfig } from "./sso.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_ID_TTL_MS = 60 * 60 * 1000;

const asStringList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : undefined);
const first = (v: unknown): string | undefined => (Array.isArray(v) ? (v[0] === undefined ? undefined : String(v[0])) : typeof v === "string" ? v : undefined);

export function samlRoutes(ctx: Ctx) {
  const { db, config } = ctx;

  /** Request ids live in Postgres so any replica can validate InResponseTo, exactly once. */
  const cacheProvider: CacheProvider = {
    async saveAsync(key, value) {
      await db.execute(sql`DELETE FROM auth.saml_request_cache WHERE created_at < now() - interval '2 hours'`);
      await db.execute(sql`INSERT INTO auth.saml_request_cache (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO NOTHING`);
      return { value, createdAt: Date.now() };
    },
    async getAsync(key) {
      const res = await db.execute(sql`SELECT value FROM auth.saml_request_cache WHERE key = ${key} AND created_at > now() - ${REQUEST_ID_TTL_MS / 1000} * interval '1 second'`);
      return (res.rows[0] as { value: string } | undefined)?.value ?? null;
    },
    async removeAsync(key) {
      if (!key) return null;
      const res = await db.execute(sql`DELETE FROM auth.saml_request_cache WHERE key = ${key} RETURNING value`);
      return (res.rows[0] as { value: string } | undefined)?.value ?? null;
    },
  };

  const entityId = (p: Provider, cfg: { spEntityId?: string | undefined }) => cfg.spEntityId || `${config.publicUrl}/api/v1/auth/saml/${p.slug}/metadata`;

  function samlFor(p: Provider): { saml: SAML; cfg: ReturnType<typeof samlConfig.parse> } {
    const cfg = samlConfig.parse(p.config);
    const issuer = entityId(p, cfg);
    const saml = new SAML({
      callbackUrl: `${config.publicUrl}/api/v1/auth/saml/${p.slug}/acs`,
      entryPoint: assertIdpUrl(cfg.entryPoint, config.allowInsecureIdp).toString(),
      issuer,
      audience: issuer,
      idpCert: cfg.idpCert,
      ...(cfg.idpIssuer ? { idpIssuer: cfg.idpIssuer } : {}),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      identifierFormat: null,
      disableRequestedAuthnContext: true,
      acceptedClockSkewMs: 60_000,
      maxAssertionAgeMs: 10 * 60_000,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: REQUEST_ID_TTL_MS,
      cacheProvider,
    });
    return { saml, cfg };
  }

  async function loadProvider(slug: string): Promise<Provider> {
    const [p] = await db.select().from(idpProviders).where(eq(idpProviders.slug, slug));
    if (!p || !p.enabled || p.kind !== "saml") throw new HttpError(404, "provider_not_found");
    return p;
  }

  const toExternal = (p: Provider, cfg: ReturnType<typeof samlConfig.parse>, profile: Profile): ExternalProfile => {
    const email = first(profile[cfg.emailAttr]) ?? first(profile.email) ?? first(profile.mail) ?? first(profile["urn:oid:0.9.2342.19200300.100.1.3"]) ?? (profile.nameID.includes("@") ? profile.nameID : undefined);
    const name = first(profile[cfg.nameAttr]) ?? ([first(profile.givenName), first(profile.sn)].filter(Boolean).join(" ") || undefined);
    return {
      subject: profile.nameID,
      email,
      // A signed assertion from the configured IdP is authoritative for its own users; `trustEmail` still decides whether it may link existing accounts.
      emailVerified: email ? true : undefined,
      name,
      groups: cfg.groupsAttr ? asStringList(profile[cfg.groupsAttr]) : undefined,
      claims: { nameID: profile.nameID, issuer: profile.issuer, email },
    };
  };

  const loginRedirect = (reply: FastifyReply, error: string) => reply.redirect(`${config.publicUrl}/login?error=${encodeURIComponent(error)}`, 302);

  return async (r: FastifyInstance) => {
    r.get("/v1/auth/saml/:slug/metadata", async (req, reply) => {
      const p = await loadProvider((req.params as { slug: string }).slug);
      const { saml } = samlFor(p);
      return reply.type("application/samlmetadata+xml").send(saml.generateServiceProviderMetadata(null, null));
    });

    r.get("/v1/auth/saml/:slug/start", { config: ctx.limit }, async (req, reply) => {
      const p = await loadProvider((req.params as { slug: string }).slug);
      const { saml } = samlFor(p);
      const state = randomToken(24);
      await db.delete(ssoStates).where(sql`${ssoStates.expiresAt} < now()`);
      await db.insert(ssoStates).values({ state, providerId: p.id, redirectTo: safeNext((req.query as { next?: string }).next), expiresAt: new Date(Date.now() + STATE_TTL_MS) });
      return reply.redirect(await saml.getAuthorizeUrlAsync(state, undefined, {}), 302);
    });

    r.post("/v1/auth/saml/:slug/acs", { config: ctx.limit }, async (req: FastifyRequest, reply: FastifyReply) => {
      const slug = (req.params as { slug: string }).slug;
      const body = (req.body ?? {}) as { SAMLResponse?: string; RelayState?: string };
      try {
        const p = await loadProvider(slug);
        if (!body.SAMLResponse || !body.RelayState) throw new SsoError("invalid_request");
        // Only responses to a login we started (SP-initiated) are accepted: the state is single use.
        const [st] = await db.delete(ssoStates).where(sql`${ssoStates.state} = ${body.RelayState} AND ${ssoStates.providerId} = ${p.id}`).returning();
        if (!st || st.expiresAt < new Date()) throw new SsoError("invalid_state");
        const { saml, cfg } = samlFor(p);
        const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: body.SAMLResponse, RelayState: body.RelayState }).catch(() => {
          throw new SsoError("invalid_saml_response");
        });
        if (!profile?.nameID) throw new SsoError("invalid_saml_response");
        // node-saml only checks the issuer on logout messages, so enforce the configured IdP entity id here.
        if (cfg.idpIssuer && profile.issuer !== cfg.idpIssuer) throw new SsoError("invalid_saml_response");
        const userId = await resolveSsoUser(ctx, p, toExternal(p, cfg, profile));
        await ctx.audit("login.sso", req, userId, p.slug);
        await ctx.startSession(req, reply, userId, ["sso"]);
        return reply.redirect(`${config.publicUrl}${safeNext(st.redirectTo)}`, 302);
      } catch (err) {
        const code = err instanceof SsoError ? err.code : err instanceof HttpError ? err.code : "sso_failed";
        if (!(err instanceof SsoError)) req.log.warn({ err: String(err) }, "saml acs failed");
        await ctx.audit("login.sso_failed", req, null, slug, { code });
        return loginRedirect(reply, code);
      }
    });
  };
}
