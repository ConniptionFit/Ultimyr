import { generate } from "otplib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, bearer, createHarness, register, testDbUrl, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("TOTP and recovery codes", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot();
  });
  afterAll(() => h.close());

  async function enableTotp() {
    const reg = (await register(h.app, "a@example.com")).json();
    const token = reg.accessToken as string;
    const setup = (await h.app.inject({ method: "POST", url: "/v1/me/mfa/totp/setup", headers: bearer(token) })).json();
    const code = await generate({ secret: setup.secret });
    const confirm = await h.app.inject({ method: "POST", url: "/v1/me/mfa/totp/confirm", headers: bearer(token), payload: { code } });
    return { token, secret: setup.secret as string, setup, confirm, code };
  }
  const login = () =>
    h.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@example.com", password: PASSWORD } });

  it("setup returns an otpauth URI and the seed is stored encrypted, not in plaintext", async () => {
    const { setup, confirm } = await enableTotp();
    expect(setup.otpauthUri).toMatch(/^otpauth:\/\/totp\/Ultimyr:a%40example\.com\?/);
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json().recoveryCodes).toHaveLength(10);
    const { rows } = await h.pool.query("SELECT secret_enc FROM auth.totp_factors");
    expect(Buffer.from(rows[0].secret_enc).toString("latin1")).not.toContain(setup.secret);
  });

  it("a wrong code does not enable TOTP", async () => {
    const reg = (await register(h.app, "a@example.com")).json();
    await h.app.inject({ method: "POST", url: "/v1/me/mfa/totp/setup", headers: bearer(reg.accessToken) });
    const res = await h.app.inject({ method: "POST", url: "/v1/me/mfa/totp/confirm", headers: bearer(reg.accessToken), payload: { code: "000000" } });
    expect(res.statusCode).toBe(400);
    expect((await login()).json().mfaRequired).toBeUndefined();
  });

  it("password login then demands a TOTP code and issues a session with amr pwd+otp", async () => {
    const { secret, code } = await enableTotp();
    const first = (await login()).json();
    expect(first.mfaRequired).toBe(true);
    expect(first.accessToken).toBeUndefined();

    // The code used to enable TOTP cannot be replayed within its time step.
    const replay = await h.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { mfaToken: first.mfaToken, code } });
    expect(replay.statusCode).toBe(401);

    // A fresh time step works.
    const next = await generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    const ok = await h.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { mfaToken: first.mfaToken, code: next } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();
    const { rows } = await h.pool.query("SELECT amr FROM auth.sessions ORDER BY created_at DESC LIMIT 1");
    expect(rows[0].amr).toEqual(["pwd", "otp"]);
  });

  it("recovery codes work once", async () => {
    const { confirm } = await enableTotp();
    const [rc] = confirm.json().recoveryCodes as string[];
    const t1 = (await login()).json().mfaToken;
    const ok = await h.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { mfaToken: t1, recoveryCode: rc } });
    expect(ok.statusCode).toBe(200);
    const t2 = (await login()).json().mfaToken;
    const again = await h.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { mfaToken: t2, recoveryCode: rc } });
    expect(again.statusCode).toBe(401);
  });

  it("locks the factor after repeated wrong codes", async () => {
    await enableTotp();
    const t = (await login()).json().mfaToken;
    for (let i = 0; i < 5; i++) {
      const bad = await h.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { mfaToken: t, code: "111111" } });
      expect(bad.statusCode).toBe(401);
    }
    const locked = await h.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { mfaToken: t, code: "222222" } });
    expect(locked.statusCode).toBe(429);
  });

  it("rejects forged, expired-audience and wrong-type MFA tokens", async () => {
    await enableTotp();
    const bad = await h.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { mfaToken: "x.y.z-not-a-jwt", code: "123456" } });
    expect(bad.statusCode).toBe(401);
    // An access token must not be accepted as an MFA token.
    const reg = (await h.app.inject({ method: "POST", url: "/v1/auth/register", payload: { email: "b@example.com", password: PASSWORD, displayName: "B" } })).json();
    const swapped = await h.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { mfaToken: reg.accessToken, code: "123456" } });
    expect(swapped.statusCode).toBe(401);
  });

  it("disabling TOTP needs the password or a code", async () => {
    const { token } = await enableTotp();
    const no = await h.app.inject({ method: "DELETE", url: "/v1/me/mfa/totp", headers: bearer(token), payload: {} });
    expect(no.statusCode).toBe(403);
    const wrong = await h.app.inject({ method: "DELETE", url: "/v1/me/mfa/totp", headers: bearer(token), payload: { password: "nope nope nope nope" } });
    expect(wrong.statusCode).toBe(403);
    const ok = await h.app.inject({ method: "DELETE", url: "/v1/me/mfa/totp", headers: bearer(token), payload: { password: PASSWORD } });
    expect(ok.statusCode).toBe(204);
    expect((await login()).json().accessToken).toBeTruthy();
  });

  it("reports MFA status", async () => {
    const { token } = await enableTotp();
    const s = (await h.app.inject({ url: "/v1/me/mfa", headers: bearer(token) })).json();
    expect(s).toMatchObject({ totp: { enabled: true }, passkeys: 0, recoveryCodesRemaining: 10, hasPassword: true });
  });
});
