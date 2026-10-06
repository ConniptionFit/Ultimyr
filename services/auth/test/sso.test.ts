import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockIdp, type Authorization } from "./mockidp.js";
import { PASSWORD, bearer, cookieOf, createHarness, register, testDbUrl, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("OIDC and OAuth2 sign-in", () => {
  let h: Harness;
  let idp: MockIdp;
  let admin: string;
  beforeAll(async () => {
    h = await createHarness();
    idp = await new MockIdp().start();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot();
    idp.tokenRequests = [];
    admin = (await register(h.app, "admin@example.com")).json().accessToken;
  });
  afterAll(async () => {
    await idp.stop();
    await h.close();
  });

  const createProvider = (over: Record<string, unknown> = {}) =>
    h.app.inject({
      method: "POST",
      url: "/v1/admin/idp-providers",
      headers: bearer(admin),
      payload: {
        slug: "corp",
        kind: "oidc",
        name: "Corp SSO",
        config: { issuer: idp.issuer, clientId: idp.clientId },
        clientSecret: idp.clientSecret,
        ...over,
      },
    });

  /** Run the whole browser flow: /start, IdP login, /callback. Returns the final callback response. */
  async function signIn(a: Authorization = {}, slug = "corp", mutate?: (q: { code: string; state: string }) => { code: string; state: string }) {
    const start = await h.app.inject({ url: `/v1/auth/sso/${slug}/start?next=/settings` });
    expect(start.statusCode).toBe(302);
    const loc = start.headers.location as string;
    let q = idp.authorize(loc, a);
    if (mutate) q = mutate(q);
    const cb = await h.app.inject({ url: `/v1/auth/sso/${slug}/callback?code=${q.code}&state=${q.state}` });
    return { start: loc, cb };
  }
  const errorOf = (cb: { headers: Record<string, unknown> }) => new URL(String(cb.headers.location)).searchParams.get("error");
  const claims = (extra: Record<string, unknown> = {}) => ({ sub: "idp-user-1", email: "ada@corp.example", email_verified: true, name: "Ada Lovelace", ...extra });

  it("sends the browser to the IdP with PKCE, state and nonce", async () => {
    await createProvider();
    const start = await h.app.inject({ url: "/v1/auth/sso/corp/start" });
    const u = new URL(start.headers.location as string);
    expect(u.origin + u.pathname).toBe(`${idp.issuer}/authorize`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid email profile");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/v1/auth/sso/corp/callback");
    expect(u.searchParams.get("state")!.length).toBeGreaterThan(20);
    expect(u.searchParams.get("nonce")!.length).toBeGreaterThan(10);
  });

  it("creates a user just in time, starts an sso session and redirects to the requested page", async () => {
    await createProvider();
    const { cb } = await signIn({ claims: claims() });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe("http://localhost:3000/settings");
    expect(cookieOf(cb)).toBeTruthy();

    const refresh = await h.app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: cookieOf(cb)! } });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().user).toMatchObject({ email: "ada@corp.example", roles: expect.arrayContaining(["author", "learner"]) });
    expect(refresh.json().user.roles).not.toContain("platform_admin");
    const { rows } = await h.pool.query("SELECT created_via, password_hash FROM auth.users WHERE email = 'ada@corp.example'");
    expect(rows[0]).toEqual({ created_via: "sso", password_hash: null });
    expect((await h.pool.query("SELECT amr FROM auth.sessions ORDER BY created_at DESC LIMIT 1")).rows[0].amr).toEqual(["sso"]);

    // The same IdP subject maps to the same user next time (even if the email changes at the IdP).
    await signIn({ claims: claims({ email: "ada.new@corp.example" }) });
    expect((await h.pool.query("SELECT count(*)::int AS n FROM auth.users WHERE created_via = 'sso'")).rows[0].n).toBe(1);
  });

  it("stores the client secret encrypted and never returns it", async () => {
    const res = await createProvider();
    expect(res.statusCode).toBe(201);
    expect(res.json().hasClientSecret).toBe(true);
    expect(JSON.stringify(res.json())).not.toContain(idp.clientSecret);
    const { rows } = await h.pool.query("SELECT client_secret_enc FROM auth.idp_providers");
    expect(Buffer.from(rows[0].client_secret_enc).toString("latin1")).not.toContain(idp.clientSecret);
    expect(JSON.stringify((await h.app.inject({ url: "/v1/admin/idp-providers", headers: bearer(admin) })).json())).not.toContain(idp.clientSecret);
    expect(idp.tokenRequests).toHaveLength(0);
    await signIn({ claims: claims() });
    expect(idp.tokenRequests[0]?.client_secret).toBe(idp.clientSecret); // decrypted only to call the IdP
    expect(idp.tokenRequests[0]?.code_verifier).toBeTruthy();
  });

  it("supports client_secret_basic", async () => {
    await createProvider({ config: { issuer: idp.issuer, clientId: idp.clientId, tokenAuthMethod: "basic" } });
    const { cb } = await signIn({ claims: claims() });
    expect(cb.headers.location).toBe("http://localhost:3000/settings");
    expect(idp.tokenRequests[0]?.client_secret).toBeUndefined();
  });

  it("rejects bad state, replayed state, and a state from another provider", async () => {
    await createProvider();
    await createProvider({ slug: "other", name: "Other" });
    expect(errorOf((await signIn({ claims: claims() }, "corp", (q) => ({ ...q, state: "forged" }))).cb)).toBe("invalid_state");

    const start = await h.app.inject({ url: "/v1/auth/sso/corp/start" });
    const q = idp.authorize(start.headers.location as string, { claims: claims() });
    expect((await h.app.inject({ url: `/v1/auth/sso/other/callback?code=${q.code}&state=${q.state}` })).headers.location).toContain("error=invalid_state");
    // That attempt consumed nothing for "corp" (wrong provider): the real callback still works once...
    const ok = await h.app.inject({ url: `/v1/auth/sso/corp/callback?code=${q.code}&state=${q.state}` });
    expect(ok.headers.location).toBe("http://localhost:3000/reading-room");
    // ...and never twice.
    const again = await h.app.inject({ url: `/v1/auth/sso/corp/callback?code=${q.code}&state=${q.state}` });
    expect(errorOf(again)).toBe("invalid_state");
  });

  it("rejects ID tokens with the wrong nonce, audience, issuer, signature or expiry, or none", async () => {
    await createProvider();
    for (const override of [{ nonce: "attacker" }, { aud: "someone-else" }, { iss: "https://evil.example" }, { otherKey: true }, { expiresIn: "-10m" }]) {
      const { cb } = await signIn({ claims: claims(), override });
      expect(errorOf(cb), JSON.stringify(override)).toMatch(/invalid_id_token|invalid_nonce/);
      expect(cookieOf(cb)).toBeUndefined();
    }
    expect(errorOf((await signIn({ claims: claims(), override: { omitIdToken: true } })).cb)).toBe("missing_id_token");
    expect((await h.pool.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n).toBe(1); // only the admin
  });

  it("does not take over an existing local account by email unless the IdP is trusted and verified", async () => {
    await register(h.app, "ada@corp.example");
    await createProvider();
    expect(errorOf((await signIn({ claims: claims() })).cb)).toBe("account_exists");

    await h.app.inject({ method: "PATCH", url: `/v1/admin/idp-providers/${(await h.pool.query("SELECT id FROM auth.idp_providers")).rows[0].id}`, headers: bearer(admin), payload: { trustEmail: true } });
    expect(errorOf((await signIn({ claims: claims({ email_verified: false }) })).cb)).toBe("account_exists");
    const ok = await signIn({ claims: claims() });
    expect(ok.cb.headers.location).toBe("http://localhost:3000/settings");
    expect((await h.pool.query("SELECT count(*)::int AS n FROM auth.identities")).rows[0].n).toBe(1);
  });

  it("respects just-in-time provisioning off, disabled providers and suspended users", async () => {
    await createProvider({ jitProvisioning: false });
    expect(errorOf((await signIn({ claims: claims() })).cb)).toBe("not_provisioned");
    const id = (await h.pool.query("SELECT id FROM auth.idp_providers")).rows[0].id;
    await h.app.inject({ method: "PATCH", url: `/v1/admin/idp-providers/${id}`, headers: bearer(admin), payload: { jitProvisioning: true } });
    await signIn({ claims: claims() });
    await h.pool.query("UPDATE auth.users SET status = 'suspended' WHERE email = 'ada@corp.example'");
    expect(errorOf((await signIn({ claims: claims() })).cb)).toBe("account_disabled");
    await h.app.inject({ method: "PATCH", url: `/v1/admin/idp-providers/${id}`, headers: bearer(admin), payload: { enabled: false } });
    expect((await h.app.inject({ url: "/v1/auth/sso/corp/start" })).statusCode).toBe(404);
    expect((await h.app.inject({ url: "/v1/auth/sso/providers" })).json()).toEqual([]);
  });

  it("needs an email to create a new account", async () => {
    await createProvider();
    expect(errorOf((await signIn({ claims: { sub: "no-email" } })).cb)).toBe("email_required");
  });

  it("syncs groups from the configured claim, adding and removing memberships", async () => {
    await createProvider({ groupClaim: "groups" });
    await signIn({ claims: claims({ groups: ["staff", "admins"] }) });
    const uid = (await h.pool.query("SELECT id FROM auth.users WHERE email = 'ada@corp.example'")).rows[0].id;
    const mine = async () => (await h.pool.query("SELECT g.name FROM auth.group_members m JOIN auth.groups g ON g.id = m.group_id WHERE m.user_id = $1 ORDER BY g.name", [uid])).rows.map((r) => r.name);
    expect(await mine()).toEqual(["Corp SSO: admins", "Corp SSO: staff"]);
    await signIn({ claims: claims({ groups: ["staff"] }) });
    expect(await mine()).toEqual(["Corp SSO: staff"]);
    await signIn({ claims: claims({ groups: [] }) });
    expect(await mine()).toEqual([]);
  });

  it("falls back to userinfo for the email when the ID token omits it", async () => {
    await createProvider();
    const { cb } = await signIn({ claims: { sub: "u9", email: "late@corp.example", name: "Late" } });
    expect(cb.headers.location).toBe("http://localhost:3000/settings");
  });

  it("validates provider config and refuses insecure IdP URLs in production mode", async () => {
    expect((await createProvider({ slug: "Bad Slug" })).statusCode).toBe(400);
    expect((await createProvider({ config: { issuer: "not a url", clientId: "x" } })).statusCode).toBe(400);
    expect((await createProvider()).statusCode).toBe(201);
    expect((await createProvider()).statusCode).toBe(409);

    await h.boot({ ULTIMYR_ALLOW_INSECURE_IDP: "false" });
    const strict = await h.app.inject({
      method: "POST",
      url: "/v1/admin/idp-providers",
      headers: bearer(admin),
      payload: { slug: "plain-http", kind: "oidc", name: "x", config: { issuer: "http://idp.example.com", clientId: "c" } },
    });
    expect(strict.statusCode).toBe(400);
    expect(strict.json().error).toBe("insecure_idp_url");
  });

  it("only admins manage providers", async () => {
    const user = (await register(h.app, "u@example.com")).json().accessToken;
    expect((await h.app.inject({ url: "/v1/admin/idp-providers", headers: bearer(user) })).statusCode).toBe(403);
  });

  it("ignores open-redirect attempts in next", async () => {
    await createProvider();
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      const start = await h.app.inject({ url: `/v1/auth/sso/corp/start?next=${encodeURIComponent(next)}` });
      const q = idp.authorize(start.headers.location as string, { claims: claims({ sub: `s-${next.length}`, email: `u${next.length}@corp.example` }) });
      const cb = await h.app.inject({ url: `/v1/auth/sso/corp/callback?code=${q.code}&state=${q.state}` });
      expect(cb.headers.location).toBe("http://localhost:3000/reading-room");
    }
  });

  it("generic OAuth2 providers map fields from the userinfo endpoint", async () => {
    const made = await createProvider({
      slug: "gh",
      kind: "oauth2",
      name: "OAuth Service",
      config: { authorizeUrl: `${idp.issuer}/authorize`, tokenUrl: `${idp.issuer}/token`, userinfoUrl: `${idp.issuer}/userinfo`, clientId: idp.clientId, scopes: ["read:user"], subjectField: "id", emailVerifiedField: "verified", groupsField: "teams" },
      groupClaim: "teams",
    });
    expect(made.json(), JSON.stringify(made.json())).toMatchObject({ slug: "gh" });
    const start = await h.app.inject({ url: "/v1/auth/sso/gh/start" });
    expect(new URL(start.headers.location as string).searchParams.get("scope")).toBe("read:user");
    const q = idp.authorize(start.headers.location as string, { claims: { id: 4242, email: "octo@example.com", name: "Octo", verified: true, teams: ["core"] } });
    const cb = await h.app.inject({ url: `/v1/auth/sso/gh/callback?code=${q.code}&state=${q.state}` });
    expect(cb.headers.location).toBe("http://localhost:3000/reading-room");
    const ident = (await h.pool.query("SELECT subject FROM auth.identities")).rows[0];
    expect(ident.subject).toBe("4242");
    expect((await h.pool.query("SELECT name FROM auth.groups")).rows[0].name).toBe("OAuth Service: core");
  });

  it("lists enabled providers publicly and shows linked identities to the user", async () => {
    await createProvider();
    expect((await h.app.inject({ url: "/v1/auth/sso/providers" })).json()).toEqual([{ slug: "corp", name: "Corp SSO", kind: "oidc", startUrl: "/api/v1/auth/sso/corp/start" }]);
    const { cb } = await signIn({ claims: claims() });
    const refresh = await h.app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: cookieOf(cb)! } });
    const ids = (await h.app.inject({ url: "/v1/me/identities", headers: bearer(refresh.json().accessToken) })).json();
    expect(ids).toEqual([expect.objectContaining({ provider: "Corp SSO", email: "ada@corp.example" })]);
    // An SSO-only account has no password to log in with.
    expect((await h.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "ada@corp.example", password: PASSWORD } })).statusCode).toBe(401);
  });

  it("checks an issuer before anything is saved, for admins only", async () => {
    const check = (issuer: string, token = admin) => h.app.inject({ method: "POST", url: "/v1/admin/idp-providers/check", headers: bearer(token), payload: { issuer } });
    expect((await check(idp.issuer)).json()).toMatchObject({ ok: true, issuer: idp.issuer });
    // A trailing slash is the usual slip: the provider reports the address it really uses.
    expect((await check(`${idp.issuer}/`)).json()).toMatchObject({ ok: true });
    expect((await check(`${idp.issuer}/nope`)).json()).toMatchObject({ ok: false, reason: "unreachable" });
    expect((await check("ftp://example.com")).json()).toMatchObject({ ok: false });
    expect((await h.pool.query("SELECT 1 FROM auth.idp_providers")).rowCount).toBe(0);
    const learner = (await register(h.app, "bob@example.com")).json().accessToken;
    expect((await check(idp.issuer, learner)).statusCode).toBe(403);
    expect((await h.app.inject({ method: "POST", url: "/v1/admin/idp-providers/check", payload: { issuer: idp.issuer } })).statusCode).toBe(401);
  });
});
