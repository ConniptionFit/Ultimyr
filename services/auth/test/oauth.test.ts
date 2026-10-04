import { verifyAccessToken } from "@ultimyr/authz";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createHarness, register, testDbUrl, type Harness } from "./helpers.js";

const REDIRECT = "http://127.0.0.1:33333/callback";
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");

describe.skipIf(!testDbUrl)("OAuth for MCP clients", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot();
  });
  afterAll(() => h.close());

  const reg = (body: Record<string, unknown> = { client_name: "Claude", redirect_uris: [REDIRECT] }) => h.app.inject({ method: "POST", url: "/oauth/register", payload: body });
  const token = (form: Record<string, string>) => h.app.inject({ method: "POST", url: "/oauth/token", payload: new URLSearchParams(form).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });

  async function authorize(user: string, scope = ["content:read", "quiz:read"]) {
    const t = (await register(h.app, user)).json().accessToken as string;
    const client = (await reg()).json();
    const verifier = randomBytes(40).toString("base64url");
    const consent = await h.app.inject({
      method: "POST",
      url: "/v1/oauth/consent",
      headers: bearer(t),
      payload: { clientId: client.client_id, redirectUri: REDIRECT, scope, state: "xyz", codeChallenge: challengeOf(verifier), approve: true },
    });
    return { t, client, verifier, consent };
  }

  it("publishes metadata that points at its own endpoints and requires S256", async () => {
    const m = (await h.app.inject({ url: "/.well-known/oauth-authorization-server" })).json();
    expect(m).toMatchObject({ issuer: "http://localhost:3000", token_endpoint: "http://localhost:3000/oauth/token", code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] });
  });

  it("registers a public client and rejects unsafe redirect URIs", async () => {
    const ok = await reg();
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ token_endpoint_auth_method: "none", redirect_uris: [REDIRECT] });
    expect(ok.json().client_id).toMatch(/^uc_/);
    for (const bad of ["http://evil.example/cb", "javascript:alert(1)", "https://x.example/cb#frag", "not a url", "https://u:p@x.example/cb"]) {
      expect((await reg({ client_name: "x", redirect_uris: [bad] })).statusCode, bad).toBe(400);
    }
    expect((await reg({ client_name: "x", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })).statusCode).toBe(201);
    expect((await reg({ client_name: "x", redirect_uris: ["cursor://anysphere.cursor-retrieval/oauth/callback"] })).statusCode).toBe(201);
  });

  it("/authorize refuses unknown clients and redirects valid ones to the consent page", async () => {
    const client = (await reg()).json();
    const bad = await h.app.inject({ url: `/oauth/authorize?client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code` });
    expect(bad.statusCode).toBe(400);
    const wrongUri = await h.app.inject({ url: `/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent("http://127.0.0.1:1/other")}&response_type=code` });
    expect(wrongUri.statusCode).toBe(400);
    const q = (extra: string) => h.app.inject({ url: `/oauth/authorize?client_id=${client.client_id}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&state=s${extra}` });
    const noPkce = await q("");
    expect(noPkce.statusCode).toBe(302);
    expect(noPkce.headers.location).toContain("error=invalid_request");
    const ok = await q(`&code_challenge=${challengeOf("a")}&code_challenge_method=S256&scope=content:read`);
    expect(ok.headers.location).toMatch(/^http:\/\/localhost:3000\/connect\?/);
    expect(new URL(ok.headers.location as string).searchParams.get("scope")).toBe("content:read");
    expect((await q(`&code_challenge=${challengeOf("a")}&code_challenge_method=S256&scope=root`)).headers.location).toContain("error=invalid_scope");
  });

  it("completes the code + PKCE flow and issues a scoped token that the auth service honors", async () => {
    const { client, verifier, consent, t } = await authorize("a@example.com");
    expect(consent.statusCode).toBe(200);
    const url = new URL(consent.json().redirectTo);
    expect(url.searchParams.get("state")).toBe("xyz");
    const code = url.searchParams.get("code")!;
    const { rows } = await h.pool.query("SELECT code_hash FROM auth.oauth_codes");
    expect(JSON.stringify(rows)).not.toContain(code);

    const res = await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body).toMatchObject({ token_type: "Bearer", scope: "content:read quiz:read" });
    const p = await verifyAccessToken(body.access_token, h.keys.publicKey);
    expect(p.scopes).toEqual(["content:read", "quiz:read"]);
    expect(p.sessionId).toMatch(/^mcp:/);
    expect(p.amr).toEqual(["oauth"]);

    // Works for /me, but cannot manage the account, authorize more apps or list connections.
    expect((await h.app.inject({ url: "/v1/me", headers: bearer(body.access_token) })).statusCode).toBe(200);
    for (const [method, url] of [["GET", "/v1/me/mcp-connections"], ["GET", "/v1/me/api-keys"], ["POST", "/v1/oauth/consent"]] as const) {
      expect((await h.app.inject({ method, url, headers: bearer(body.access_token), payload: method === "POST" ? {} : undefined })).statusCode, url).toBe(403);
    }

    const list = (await h.app.inject({ url: "/v1/me/mcp-connections", headers: bearer(t) })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ clientName: "Claude", scopes: ["content:read", "quiz:read"], createdVia: "oauth" });
    expect(JSON.stringify(list)).not.toContain("refresh");
  });

  it("codes are single use and bound to the verifier, client and redirect", async () => {
    const { client, verifier, consent } = await authorize("a@example.com");
    const code = new URL(consent.json().redirectTo).searchParams.get("code")!;
    const base = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id };
    expect((await token({ ...base, code_verifier: randomBytes(40).toString("base64url") })).json().error).toBe("invalid_grant");
    // the failed attempt burned the code
    expect((await token({ ...base, code_verifier: verifier })).json().error).toBe("invalid_grant");

    const again = await authorize("b@example.com");
    const code2 = new URL(again.consent.json().redirectTo).searchParams.get("code")!;
    expect((await token({ grant_type: "authorization_code", code: code2, redirect_uri: "http://127.0.0.1:1/x", client_id: again.client.client_id, code_verifier: again.verifier })).statusCode).toBe(400);
  });

  it("rotates refresh tokens and revokes the connection when an old one is replayed", async () => {
    const { client, verifier, consent } = await authorize("a@example.com");
    const code = new URL(consent.json().redirectTo).searchParams.get("code")!;
    const first = (await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier })).json();
    const second = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: client.client_id });
    expect(second.statusCode).toBe(200);
    expect(second.json().refresh_token).not.toBe(first.refresh_token);
    expect(second.json().scope).toBe("content:read quiz:read");

    const replay = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token });
    expect(replay.json().error).toBe("invalid_grant");
    // the connection is dead, including the newest token
    expect((await token({ grant_type: "refresh_token", refresh_token: second.json().refresh_token })).statusCode).toBe(400);
    expect((await h.app.inject({ url: "/v1/me", headers: bearer(second.json().access_token) })).statusCode).toBe(401);
  });

  it("revoking a connection stops refresh and the auth service rejects its tokens", async () => {
    const { client, verifier, consent, t } = await authorize("a@example.com");
    const code = new URL(consent.json().redirectTo).searchParams.get("code")!;
    const tok = (await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier })).json();
    const [conn] = (await h.app.inject({ url: "/v1/me/mcp-connections", headers: bearer(t) })).json();
    expect((await h.app.inject({ method: "DELETE", url: `/v1/me/mcp-connections/${conn.id}`, headers: bearer(t) })).statusCode).toBe(204);
    expect((await token({ grant_type: "refresh_token", refresh_token: tok.refresh_token })).statusCode).toBe(400);
    expect((await h.app.inject({ url: "/v1/me", headers: bearer(tok.access_token) })).statusCode).toBe(401);
    expect((await h.app.inject({ url: "/v1/me/mcp-connections", headers: bearer(t) })).json()).toEqual([]);
    expect((await h.app.inject({ method: "DELETE", url: `/v1/me/mcp-connections/${conn.id}`, headers: bearer(t) })).statusCode).toBe(404);
  });

  it("denying returns access_denied and issues no code", async () => {
    const t = (await register(h.app, "a@example.com")).json().accessToken;
    const client = (await reg()).json();
    const r = await h.app.inject({ method: "POST", url: "/v1/oauth/consent", headers: bearer(t), payload: { clientId: client.client_id, redirectUri: REDIRECT, scope: ["content:read"], state: "s", codeChallenge: challengeOf("x"), approve: false } });
    expect(new URL(r.json().redirectTo).searchParams.get("error")).toBe("access_denied");
    expect((await h.pool.query("SELECT 1 FROM auth.oauth_codes")).rowCount).toBe(0);
  });

  it("consent needs a signed in person and a registered redirect", async () => {
    const client = (await reg()).json();
    const payload = { clientId: client.client_id, redirectUri: REDIRECT, scope: ["content:read"], codeChallenge: challengeOf("x"), approve: true };
    expect((await h.app.inject({ method: "POST", url: "/v1/oauth/consent", payload })).statusCode).toBe(401);
    const t = (await register(h.app, "a@example.com")).json().accessToken;
    expect((await h.app.inject({ method: "POST", url: "/v1/oauth/consent", headers: bearer(t), payload: { ...payload, redirectUri: "https://evil.example/cb" } })).statusCode).toBe(400);
    expect((await h.app.inject({ method: "POST", url: "/v1/oauth/consent", headers: bearer(t), payload: { ...payload, scope: ["root"] } })).statusCode).toBe(400);
  });

  it("a suspended account cannot refresh", async () => {
    const { client, verifier, consent } = await authorize("a@example.com");
    const code = new URL(consent.json().redirectTo).searchParams.get("code")!;
    const tok = (await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier })).json();
    await h.pool.query("UPDATE auth.users SET status = 'suspended'");
    expect((await token({ grant_type: "refresh_token", refresh_token: tok.refresh_token })).statusCode).toBe(400);
  });
});
