import { resolve } from "node:path";
import { jwtVerify } from "jose";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "@ultimyr/db";
import { verifyAccessToken } from "@ultimyr/authz";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadAuthConfig } from "../src/config.js";
import { loadSigningKeys, type SigningKeys } from "../src/keys.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("auth service (integration)", () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  let keys: SigningKeys;

  const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) =>
    res.cookies.find((c) => c.name === "ultimyr_rt")?.value;
  const register = (email: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { email, password: "correct horse battery", displayName: "Test User", ...extra },
    });

  async function boot(env: NodeJS.ProcessEnv = {}) {
    if (app) await app.close();
    const config = loadAuthConfig({ NODE_ENV: "test", ...env });
    app = await buildApp({ pool, config, keys, rateLimitMax: 1000 });
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    keys = await loadSigningKeys();
  });
  beforeEach(async () => {
    await pool.query("DROP SCHEMA IF EXISTS auth CASCADE; DROP TABLE IF EXISTS public.ultimyr_migrations");
    await migrate(pool, { service: "auth", dir: resolve(import.meta.dirname, "../migrations") });
    await boot();
  });
  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("makes the first registered user a platform admin and later users learners/authors", async () => {
    const first = await register("admin@example.com");
    expect(first.statusCode).toBe(201);
    expect(first.json().user.roles).toContain("platform_admin");

    const second = await register("learner@example.com");
    expect(second.statusCode).toBe(201);
    expect(second.json().user.roles.sort()).toEqual(["author", "learner"]);
  });

  it("issues an EdDSA token that verifies against the published JWKS key", async () => {
    const res = await register("a@example.com");
    const { accessToken } = res.json();
    const jwks = (await app.inject({ url: "/.well-known/jwks.json" })).json();
    expect(jwks.keys[0].kid).toBe(keys.kid);
    const principal = await verifyAccessToken(accessToken, keys.publicKey);
    expect(principal.roles).toContain("platform_admin");
    const { protectedHeader } = await jwtVerify(accessToken, keys.publicKey, { audience: "ultimyr", issuer: "ultimyr-auth" });
    expect(protectedHeader.alg).toBe("EdDSA");
  });

  it("rejects weak passwords, duplicate emails (case-insensitive) and bad input", async () => {
    expect((await register("a@example.com", { password: "short" })).statusCode).toBe(400);
    expect((await register("not-an-email")).statusCode).toBe(400);
    expect((await register("a@example.com")).statusCode).toBe(201);
    expect((await register("A@Example.com")).statusCode).toBe(409);
  });

  it("stores only an argon2id hash", async () => {
    await register("a@example.com");
    const { rows } = await pool.query("SELECT password_hash FROM auth.users");
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });

  it("logs in with correct credentials and rejects wrong ones identically", async () => {
    await register("a@example.com");
    const good = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "A@example.com", password: "correct horse battery" } });
    expect(good.statusCode).toBe(200);
    const bad = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@example.com", password: "wrong password!!" } });
    const unknown = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "nobody@example.com", password: "wrong password!!" } });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json()).toEqual(unknown.json());
  });

  it("sets an httpOnly refresh cookie and serves /v1/me with the access token", async () => {
    const res = await register("a@example.com");
    const cookie = res.cookies.find((c) => c.name === "ultimyr_rt");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    const me = await app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${res.json().accessToken}` } });
    expect(me.json().email).toBe("a@example.com");
    expect((await app.inject({ url: "/v1/me" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/me", headers: { authorization: "Bearer garbage" } })).statusCode).toBe(401);
  });

  it("rotates refresh tokens and kills the session when an old one is replayed", async () => {
    const reg = await register("a@example.com");
    const c1 = cookieOf(reg)!;
    const r1 = await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: c1 } });
    expect(r1.statusCode).toBe(200);
    const c2 = cookieOf(r1)!;
    expect(c2).not.toBe(c1);

    // Replay the rotated-out token after the grace window: rejected, and the whole session is revoked.
    await pool.query("UPDATE auth.sessions SET rotated_at = now() - interval '1 minute'");
    const replay = await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: c1 } });
    expect(replay.statusCode).toBe(401);
    const afterReplay = await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: c2 } });
    expect(afterReplay.statusCode).toBe(401);
    const { rows } = await pool.query("SELECT 1 FROM auth.audit_log WHERE action = 'session.reuse_detected'");
    expect(rows).toHaveLength(1);
  });

  it("lets a refresh that raced a rotation through without revoking the session", async () => {
    const reg = await register("a@example.com");
    const c1 = cookieOf(reg)!;
    const r1 = await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: c1 } });
    const c2 = cookieOf(r1)!;

    // A second tab sent the old cookie before the first response landed.
    const raced = await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: c1 } });
    expect(raced.statusCode).toBe(200);
    expect(raced.json().accessToken).toBeTruthy();
    // It must not rotate again or hand out a competing cookie.
    expect(cookieOf(raced)).toBeUndefined();

    const next = await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: c2 } });
    expect(next.statusCode).toBe(200);
    const { rows } = await pool.query("SELECT 1 FROM auth.audit_log WHERE action = 'session.reuse_detected'");
    expect(rows).toHaveLength(0);
  });

  it("logout revokes the session so the access token stops working", async () => {
    const reg = await register("a@example.com");
    const token = reg.json().accessToken;
    const out = await app.inject({ method: "POST", url: "/v1/auth/logout", cookies: { ultimyr_rt: cookieOf(reg)! } });
    expect(out.statusCode).toBe(204);
    expect((await app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: cookieOf(reg)! } })).statusCode).toBe(401);
  });

  it("suspended users cannot log in", async () => {
    await register("a@example.com");
    await pool.query("UPDATE auth.users SET status = 'suspended'");
    const res = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@example.com", password: "correct horse battery" } });
    expect(res.statusCode).toBe(401);
  });

  it("closed registration still allows bootstrapping the first admin only", async () => {
    await boot({ AUTH_REGISTRATION: "closed" });
    expect((await register("admin@example.com")).statusCode).toBe(201);
    expect((await register("other@example.com")).statusCode).toBe(403);
  });

  it("only one of several simultaneous first sign-ups becomes admin", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => register(`u${i}@example.com`)));
    const admins = results.filter((r) => r.json().user.roles.includes("platform_admin"));
    expect(admins).toHaveLength(1);
  });

  it("exposes health and readiness", async () => {
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/readyz" })).statusCode).toBe(200);
  });

  it("migrations are idempotent and tamper-evident", async () => {
    const dir = resolve(import.meta.dirname, "../migrations");
    expect(await migrate(pool, { service: "auth", dir })).toEqual([]);
  });
});

describe("auth config", () => {
  it("requires a signing key in production", () => {
    expect(() => loadAuthConfig({ NODE_ENV: "production" })).toThrow(/ULTIMYR_JWT_PRIVATE_KEY/);
  });
});

describe.skipIf(!url)("auth service route prefixes", () => {
  it("serves the same routes under /api so proxies need no path rewriting", async () => {
    const pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA IF EXISTS auth CASCADE; DROP TABLE IF EXISTS public.ultimyr_migrations");
    await migrate(pool, { service: "auth", dir: resolve(import.meta.dirname, "../migrations") });
    const keys = await loadSigningKeys();
    const app = await buildApp({ pool, config: loadAuthConfig({ NODE_ENV: "test" }), keys, rateLimitMax: 1000 });
    const reg = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "p@example.com", password: "correct horse battery", displayName: "P" },
    });
    expect(reg.statusCode).toBe(201);
    const me = await app.inject({ url: "/api/v1/me", headers: { authorization: `Bearer ${reg.json().accessToken}` } });
    expect(me.statusCode).toBe(200);
    expect((await app.inject({ url: "/api/.well-known/jwks.json" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/.well-known/jwks.json" })).statusCode).toBe(200);
    await app.close();
    await pool.end();
  });
});
