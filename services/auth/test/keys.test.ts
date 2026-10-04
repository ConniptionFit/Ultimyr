import { verifyAccessToken } from "@ultimyr/authz";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, cookieOf, createHarness, register, testDbUrl, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("API keys and sessions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot();
  });
  afterAll(() => h.close());

  async function setup() {
    const reg = (await register(h.app, "a@example.com")).json();
    return reg.accessToken as string;
  }
  const createKey = (token: string, body: Record<string, unknown> = { name: "ci", scopes: ["content:read"] }) =>
    h.app.inject({ method: "POST", url: "/v1/me/api-keys", headers: bearer(token), payload: body });
  const exchange = (key: string) => h.app.inject({ method: "POST", url: "/v1/auth/token", headers: bearer(key) });

  it("creates a key shown once, stores only a hash, and exchanges it for a scoped token", async () => {
    const token = await setup();
    const created = await createKey(token, { name: "mcp", scopes: ["content:read", "content:write"] });
    expect(created.statusCode).toBe(201);
    const { key, id } = created.json();
    expect(key).toMatch(/^ulk_[0-9a-f]{8}_/);

    const { rows } = await h.pool.query("SELECT key_hash, prefix FROM auth.api_keys");
    expect(JSON.stringify(rows)).not.toContain(key.split("_").slice(2).join("_"));

    const list = (await h.app.inject({ url: "/v1/me/api-keys", headers: bearer(token) })).json();
    expect(list[0]).not.toHaveProperty("key");
    expect(list[0].prefix).toBe(key.slice(0, 12));

    const ex = await exchange(key);
    expect(ex.statusCode).toBe(200);
    const principal = await verifyAccessToken(ex.json().accessToken, h.keys.publicKey);
    expect(principal.scopes).toEqual(["content:read", "content:write"]);
    expect(principal.amr).toEqual(["apikey"]);
    expect(principal.sessionId).toBe(`key:${id}`);

    // The scoped token works as the user on /v1/me.
    const me = await h.app.inject({ url: "/v1/me", headers: bearer(ex.json().accessToken) });
    expect(me.json().email).toBe("a@example.com");
  });

  it("rejects bad, tampered, revoked and expired keys", async () => {
    const token = await setup();
    const { key, id } = (await createKey(token)).json();
    expect((await exchange("nope")).statusCode).toBe(401);
    expect((await exchange(key.slice(0, -1) + (key.endsWith("A") ? "B" : "A"))).statusCode).toBe(401);

    const ex = await exchange(key);
    expect(ex.statusCode).toBe(200);
    await h.app.inject({ method: "DELETE", url: `/v1/me/api-keys/${id}`, headers: bearer(token) });
    expect((await exchange(key)).statusCode).toBe(401);
    // Already-issued tokens stop working immediately too.
    expect((await h.app.inject({ url: "/v1/me", headers: bearer(ex.json().accessToken) })).statusCode).toBe(401);

    const { key: k2, id: id2 } = (await createKey(token, { name: "short", scopes: ["quiz:read"], expiresInDays: 1 })).json();
    await h.pool.query("UPDATE auth.api_keys SET expires_at = now() - interval '1 minute' WHERE id = $1", [id2]);
    expect((await exchange(k2)).statusCode).toBe(401);
  });

  it("validates scopes and caps the number of keys", async () => {
    const token = await setup();
    expect((await createKey(token, { name: "x", scopes: ["admin:everything"] })).statusCode).toBe(400);
    expect((await createKey(token, { name: "x", scopes: [] })).statusCode).toBe(400);
    for (let i = 0; i < 25; i++) expect((await createKey(token, { name: `k${i}`, scopes: ["quiz:read"] })).statusCode).toBe(201);
    expect((await createKey(token)).statusCode).toBe(409);
  });

  it("API-key tokens cannot manage keys, MFA, passkeys or sessions (no privilege escalation)", async () => {
    const token = await setup();
    const { key } = (await createKey(token, { name: "k", scopes: ["content:write"] })).json();
    const scoped = (await exchange(key)).json().accessToken as string;
    for (const [method, url] of [
      ["POST", "/v1/me/api-keys"],
      ["GET", "/v1/me/api-keys"],
      ["POST", "/v1/me/mfa/totp/setup"],
      ["POST", "/v1/me/passkeys/register/options"],
      ["GET", "/v1/me/sessions"],
    ] as const) {
      const res = await h.app.inject({ method, url, headers: bearer(scoped), payload: { name: "x", scopes: ["content:read"] } });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("one user cannot revoke another user's key or session", async () => {
    const t1 = await setup();
    const t2 = (await register(h.app, "b@example.com")).json().accessToken as string;
    const { id } = (await createKey(t1)).json();
    expect((await h.app.inject({ method: "DELETE", url: `/v1/me/api-keys/${id}`, headers: bearer(t2) })).statusCode).toBe(404);
    expect((await h.app.inject({ method: "DELETE", url: `/v1/me/api-keys/not-a-uuid`, headers: bearer(t2) })).statusCode).toBe(404);
    const { rows } = await h.pool.query("SELECT id FROM auth.sessions WHERE user_id = (SELECT id FROM auth.users WHERE email='a@example.com')");
    expect((await h.app.inject({ method: "DELETE", url: `/v1/me/sessions/${rows[0].id}`, headers: bearer(t2) })).statusCode).toBe(404);
  });

  it("lists sessions, marks the current one, and revoking another signs it out", async () => {
    const reg = await register(h.app, "a@example.com");
    const t1 = reg.json().accessToken as string;
    const login = await h.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@example.com", password: "correct horse battery" } });
    const t2 = login.json().accessToken as string;
    const list = (await h.app.inject({ url: "/v1/me/sessions", headers: bearer(t1) })).json();
    expect(list).toHaveLength(2);
    expect(list.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const other = list.find((s: { current: boolean }) => !s.current);
    expect((await h.app.inject({ method: "DELETE", url: `/v1/me/sessions/${other.id}`, headers: bearer(t1) })).statusCode).toBe(204);
    expect((await h.app.inject({ url: "/v1/me", headers: bearer(t2) })).statusCode).toBe(401);
    expect((await h.app.inject({ url: "/v1/me", headers: bearer(t1) })).statusCode).toBe(200);
    expect(cookieOf(login)).toBeTruthy();
  });
});
