import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, bearer, cookieOf, createHarness, register, testDbUrl, type Harness } from "./helpers.js";
import { makeIdpKey, readAuthnRequest, samlResponse, type IdpKey } from "./samlidp.js";

describe.skipIf(!testDbUrl)("SAML 2.0 sign-in", () => {
  let h: Harness;
  let admin: string;
  let idp: IdpKey;
  let other: IdpKey;
  const IDP_ISSUER = "https://idp.example/entity";
  beforeAll(async () => {
    h = await createHarness();
    idp = makeIdpKey("trusted-idp");
    other = makeIdpKey("attacker-idp");
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot();
    admin = (await register(h.app, "admin@example.com")).json().accessToken;
  });
  afterAll(() => h.close());

  const createProvider = (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}) =>
    h.app.inject({
      method: "POST",
      url: "/v1/admin/idp-providers",
      headers: bearer(admin),
      payload: {
        slug: "acme",
        kind: "saml",
        name: "Acme SAML",
        config: { entryPoint: "https://idp.example/sso", idpCert: idp.cert, idpIssuer: IDP_ISSUER, groupsAttr: "groups", ...cfg },
        ...over,
      },
    });

  /** Start the login, then let the "IdP" answer with a response built by `build`. */
  async function login(build: (r: ReturnType<typeof readAuthnRequest>) => string, slug = "acme", mutateRelay?: (s: string) => string) {
    const start = await h.app.inject({ url: `/v1/auth/saml/${slug}/start?next=/settings` });
    expect(start.statusCode).toBe(302);
    const req = readAuthnRequest(start.headers.location as string);
    const SAMLResponse = build(req);
    const acs = await h.app.inject({
      method: "POST",
      url: `/v1/auth/saml/${slug}/acs`,
      payload: new URLSearchParams({ SAMLResponse, RelayState: mutateRelay ? mutateRelay(req.relayState) : req.relayState }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    return { req, acs, SAMLResponse };
  }
  const good = (over: Partial<Parameters<typeof samlResponse>[0]> = {}) => (r: ReturnType<typeof readAuthnRequest>) =>
    samlResponse({ idp, requestId: r.id, acs: r.acs, audience: r.issuer, nameId: "ada@corp.example", attributes: { displayName: "Ada Lovelace", groups: ["staff", "ops"] }, ...over });
  const errorOf = (acs: { headers: Record<string, unknown> }) => new URL(String(acs.headers.location)).searchParams.get("error");

  it("publishes SP metadata and an AuthnRequest naming the right ACS and entity id", async () => {
    await createProvider();
    const md = await h.app.inject({ url: "/v1/auth/saml/acme/metadata" });
    expect(md.statusCode).toBe(200);
    expect(md.body).toContain("http://localhost:3000/api/v1/auth/saml/acme/acs");
    expect(md.body).toContain("http://localhost:3000/api/v1/auth/saml/acme/metadata");
    const start = await h.app.inject({ url: "/v1/auth/saml/acme/start" });
    expect((start.headers.location as string).startsWith("https://idp.example/sso?")).toBe(true);
    const req = readAuthnRequest(start.headers.location as string);
    expect(req.acs).toBe("http://localhost:3000/api/v1/auth/saml/acme/acs");
    expect(req.id).toBeTruthy();
  });

  it("accepts a signed assertion: creates the user, syncs groups, starts an sso session", async () => {
    await createProvider({ groupClaim: "groups" });
    const { acs } = await login(good());
    expect(acs.statusCode).toBe(302);
    expect(acs.headers.location).toBe("http://localhost:3000/settings");
    expect(cookieOf(acs)).toBeTruthy();
    const u = (await h.pool.query("SELECT id, display_name, created_via FROM auth.users WHERE email = 'ada@corp.example'")).rows[0];
    expect(u).toMatchObject({ display_name: "Ada Lovelace", created_via: "sso" });
    const gs = (await h.pool.query("SELECT g.name FROM auth.group_members m JOIN auth.groups g ON g.id = m.group_id WHERE m.user_id = $1 ORDER BY g.name", [u.id])).rows.map((r) => r.name);
    expect(gs).toEqual(["Acme SAML: ops", "Acme SAML: staff"]);
    expect((await h.pool.query("SELECT amr FROM auth.sessions ORDER BY created_at DESC LIMIT 1")).rows[0].amr).toEqual(["sso"]);
    // Next login for the same NameID reuses the account.
    await login(good());
    expect((await h.pool.query("SELECT count(*)::int AS n FROM auth.users WHERE created_via = 'sso'")).rows[0].n).toBe(1);
  });

  it("rejects an unsigned assertion", async () => {
    await createProvider();
    const { acs } = await login(good({ sign: false }));
    expect(errorOf(acs)).toBe("invalid_saml_response");
    expect(cookieOf(acs)).toBeUndefined();
  });

  it("rejects an assertion signed by a different key", async () => {
    await createProvider();
    const { acs } = await login(good({ idp: other }));
    expect(errorOf(acs)).toBe("invalid_saml_response");
  });

  it("rejects tampering after signing (changing the user)", async () => {
    await createProvider();
    const { acs } = await login(good({ tamper: (xml) => xml.replace("ada@corp.example", "admin@example.com") }));
    expect(errorOf(acs)).toBe("invalid_saml_response");
    expect(cookieOf(acs)).toBeUndefined();
  });

  it("rejects an XML signature wrapping attempt (evil unsigned assertion placed first)", async () => {
    await createProvider();
    const evil = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_evil" Version="2.0" IssueInstant="${new Date().toISOString()}"><saml:Issuer>${IDP_ISSUER}</saml:Issuer><saml:Subject><saml:NameID>admin@example.com</saml:NameID></saml:Subject></saml:Assertion>`;
    const { acs } = await login(good({ tamper: (xml) => xml.replace(/(<samlp:Status>.*?<\/samlp:Status>)/, `$1${evil}`) }));
    // Either the response is rejected, or the evil identity is never used.
    expect((await h.pool.query("SELECT count(*)::int AS n FROM auth.users WHERE email = 'admin@example.com' AND created_via = 'sso'")).rows[0].n).toBe(0);
    const admins = (await h.pool.query("SELECT count(*)::int AS n FROM auth.identities WHERE subject = 'admin@example.com'")).rows[0].n;
    expect(admins).toBe(0);
    expect(acs.statusCode).toBe(302);
  });

  it("rejects wrong audience, expired assertions and the wrong IdP issuer", async () => {
    await createProvider();
    expect(errorOf((await login(good({ audience: "https://other-sp.example" }))).acs)).toBe("invalid_saml_response");
    expect(errorOf((await login(good({ notOnOrAfterMs: -120_000 }))).acs)).toBe("invalid_saml_response");
    expect(errorOf((await login(good({ idpIssuer: "https://evil.example/entity" }))).acs)).toBe("invalid_saml_response");
  });

  it("rejects replays, unsolicited responses (wrong InResponseTo) and forged RelayState", async () => {
    await createProvider();
    const first = await login(good());
    expect(first.acs.headers.location).toBe("http://localhost:3000/settings");
    // Replay the exact same response with the same (now consumed) RelayState.
    const replay = await h.app.inject({
      method: "POST",
      url: "/v1/auth/saml/acme/acs",
      payload: new URLSearchParams({ SAMLResponse: first.SAMLResponse, RelayState: first.req.relayState }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(errorOf(replay)).toBe("invalid_state");
    // A fresh login attempt answered with a response to some other request id.
    expect(errorOf((await login(good({ requestId: "_not-ours" }))).acs)).toBe("invalid_saml_response");
    // IdP-initiated / forged RelayState.
    expect(errorOf((await login(good(), "acme", () => "forged")).acs)).toBe("invalid_state");
    // A response is single use even with a fresh RelayState: the request id was consumed.
    const start = await h.app.inject({ url: "/v1/auth/saml/acme/start" });
    const r2 = readAuthnRequest(start.headers.location as string);
    const resp = samlResponse({ idp, requestId: r2.id, acs: r2.acs, audience: r2.issuer, nameId: "ada@corp.example" });
    const post = (state: string) =>
      h.app.inject({ method: "POST", url: "/v1/auth/saml/acme/acs", payload: new URLSearchParams({ SAMLResponse: resp, RelayState: state }).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect((await post(r2.relayState)).headers.location).toBe("http://localhost:3000/reading-room");
    const start2 = await h.app.inject({ url: "/v1/auth/saml/acme/start" });
    expect(errorOf(await post(readAuthnRequest(start2.headers.location as string).relayState))).toBe("invalid_saml_response");
  });

  it("does not take over a local account by email without trustEmail", async () => {
    await register(h.app, "ada@corp.example");
    await createProvider();
    expect(errorOf((await login(good())).acs)).toBe("account_exists");
    const id = (await h.pool.query("SELECT id FROM auth.idp_providers")).rows[0].id;
    await h.app.inject({ method: "PATCH", url: `/v1/admin/idp-providers/${id}`, headers: bearer(admin), payload: { trustEmail: true } });
    expect((await login(good())).acs.headers.location).toBe("http://localhost:3000/settings");
  });

  it("returns 404 for unknown, disabled or non-SAML providers and refuses insecure entry points in strict mode", async () => {
    expect((await h.app.inject({ url: "/v1/auth/saml/nope/start" })).statusCode).toBe(404);
    await createProvider({}, {});
    await h.app.inject({ method: "POST", url: "/v1/admin/idp-providers", headers: bearer(admin), payload: { slug: "oidc-one", kind: "oidc", name: "O", config: { issuer: "http://127.0.0.1:1", clientId: "c" } } });
    expect((await h.app.inject({ url: "/v1/auth/saml/oidc-one/start" })).statusCode).toBe(404);
    await h.boot({ ULTIMYR_ALLOW_INSECURE_IDP: "false" });
    const strict = await createProvider({ slug: "insecure" }, { entryPoint: "http://idp.example/sso" });
    expect(strict.json().error).toBe("insecure_idp_url");
    expect(PASSWORD).toBeTruthy();
  });

  it("lists SAML providers for the login page", async () => {
    await createProvider();
    expect((await h.app.inject({ url: "/v1/auth/sso/providers" })).json()).toEqual([{ slug: "acme", name: "Acme SAML", kind: "saml", startUrl: "/api/v1/auth/saml/acme/start" }]);
  });
});
