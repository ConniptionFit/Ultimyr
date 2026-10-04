import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createHarness, register, testDbUrl, type Harness } from "./helpers.js";
import { SoftKey } from "./softkey.js";

describe.skipIf(!testDbUrl)("passkeys (WebAuthn)", () => {
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
  async function registerKey(token: string, key: SoftKey, name = "Laptop") {
    const opt = (await h.app.inject({ method: "POST", url: "/v1/me/passkeys/register/options", headers: bearer(token), payload: {} })).json();
    return h.app.inject({
      method: "POST",
      url: "/v1/me/passkeys/register/verify",
      headers: bearer(token),
      payload: { challengeId: opt.challengeId, name, response: key.register(opt.options.challenge) },
    });
  }
  async function loginWith(key: SoftKey, tweak: Parameters<SoftKey["authenticate"]>[1] = {}) {
    const opt = (await h.app.inject({ method: "POST", url: "/v1/auth/passkeys/login/options", payload: {} })).json();
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/auth/passkeys/login/verify",
      payload: { challengeId: opt.challengeId, response: key.authenticate(opt.options.challenge, tweak) },
    });
    return { res, opt };
  }

  it("registers a passkey and signs in without a password (amr webauthn)", async () => {
    const token = await setup();
    const key = new SoftKey();
    const reg = await registerKey(token, key);
    expect(reg.statusCode).toBe(200);

    const list = (await h.app.inject({ url: "/v1/me/passkeys", headers: bearer(token) })).json();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Laptop");

    const { res } = await loginWith(key);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe("a@example.com");
    const { rows } = await h.pool.query("SELECT amr FROM auth.sessions ORDER BY created_at DESC LIMIT 1");
    expect(rows[0].amr).toEqual(["webauthn"]);
  });

  it("challenges are single use", async () => {
    const token = await setup();
    const key = new SoftKey();
    await registerKey(token, key);
    const opt = (await h.app.inject({ method: "POST", url: "/v1/auth/passkeys/login/options", payload: {} })).json();
    const body = { challengeId: opt.challengeId, response: key.authenticate(opt.options.challenge) };
    expect((await h.app.inject({ method: "POST", url: "/v1/auth/passkeys/login/verify", payload: body })).statusCode).toBe(200);
    expect((await h.app.inject({ method: "POST", url: "/v1/auth/passkeys/login/verify", payload: body })).statusCode).toBe(400);
  });

  it("rejects an assertion from the wrong origin, a different key, or without user verification", async () => {
    const token = await setup();
    const key = new SoftKey();
    await registerKey(token, key);
    expect((await loginWith(key, { origin: "https://evil.example" })).res.statusCode).toBe(401);
    expect((await loginWith(key, { flags: 0x01 })).res.statusCode).toBe(401); // user present only, no UV

    const stranger = new SoftKey();
    expect((await loginWith(stranger)).res.statusCode).toBe(401);
  });

  it("rejects a replayed or cloned authenticator (counter must increase)", async () => {
    const token = await setup();
    const key = new SoftKey();
    await registerKey(token, key);
    expect((await loginWith(key, { counter: 5 })).res.statusCode).toBe(200);
    expect((await loginWith(key, { counter: 5 })).res.statusCode).toBe(401);
    expect((await loginWith(key, { counter: 3 })).res.statusCode).toBe(401);
    expect((await loginWith(key, { counter: 6 })).res.statusCode).toBe(200);
  });

  it("rejects registration from the wrong origin and duplicate credentials", async () => {
    const token = await setup();
    const key = new SoftKey();
    const opt = (await h.app.inject({ method: "POST", url: "/v1/me/passkeys/register/options", headers: bearer(token), payload: {} })).json();
    const bad = await h.app.inject({
      method: "POST",
      url: "/v1/me/passkeys/register/verify",
      headers: bearer(token),
      payload: { challengeId: opt.challengeId, response: key.register(opt.options.challenge, { origin: "https://evil.example" }) },
    });
    expect(bad.statusCode).toBe(400);
    expect((await registerKey(token, key)).statusCode).toBe(200);
    expect((await registerKey(token, key)).statusCode).toBe(409);
  });

  it("another user cannot consume or use someone else's registration challenge", async () => {
    const t1 = await setup();
    const t2 = (await register(h.app, "b@example.com")).json().accessToken as string;
    const opt = (await h.app.inject({ method: "POST", url: "/v1/me/passkeys/register/options", headers: bearer(t1), payload: {} })).json();
    const key = new SoftKey();
    const res = await h.app.inject({
      method: "POST",
      url: "/v1/me/passkeys/register/verify",
      headers: bearer(t2),
      payload: { challengeId: opt.challengeId, response: key.register(opt.options.challenge) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("can remove a passkey, and passkey-only accounts keep their last one", async () => {
    const token = await setup();
    const key = new SoftKey();
    const { id } = (await registerKey(token, key)).json();
    const del = await h.app.inject({ method: "DELETE", url: `/v1/me/passkeys/${id}`, headers: bearer(token) });
    expect(del.statusCode).toBe(204);
    expect((await loginWith(key)).res.statusCode).toBe(401);

    await h.pool.query("UPDATE auth.users SET password_hash = NULL");
    const { id: id2 } = (await registerKey(token, new SoftKey())).json();
    expect((await h.app.inject({ method: "DELETE", url: `/v1/me/passkeys/${id2}`, headers: bearer(token) })).statusCode).toBe(409);
  });
});
