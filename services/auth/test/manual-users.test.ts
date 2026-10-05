import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createHarness, register, type Harness } from "./helpers.js";

const NEW_PASSWORD = "a brand new passphrase";

describe.skipIf(!process.env.TEST_DATABASE_URL)("manual user creation", () => {
  let h: Harness;
  let admin: { accessToken: string };
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot({ AUTH_REGISTRATION: "open" });
    admin = (await register(h.app, "ada@example.com")).json();
  });
  afterAll(() => h.close());

  const create = (payload: Record<string, unknown>, token = admin.accessToken) =>
    h.app.inject({ method: "POST", url: "/v1/admin/users", headers: bearer(token), payload });
  const login = (email: string, password: string) => h.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });
  const setting = (payload: Record<string, unknown>) => h.app.inject({ method: "PATCH", url: "/v1/admin/settings", headers: bearer(admin.accessToken), payload });
  const addProvider = () =>
    h.pool.query(
      `INSERT INTO auth.idp_providers (id, slug, kind, name, config) VALUES (gen_random_uuid(), 'idp', 'oidc', 'IdP', '{}'::jsonb)`,
    );

  it("is admin only", async () => {
    const learner = (await register(h.app, "bob@example.com")).json();
    expect((await h.app.inject({ method: "POST", url: "/v1/admin/users", payload: {} })).statusCode).toBe(401);
    expect((await create({ email: "x@example.com", displayName: "X" }, learner.accessToken)).statusCode).toBe(403);
  });

  it("creates a user with a temporary password that must be changed at first sign-in", async () => {
    const res = await create({ email: "cy@example.com", displayName: "Cy", method: "password", roles: ["learner"] });
    expect(res.statusCode).toBe(201);
    const { temporaryPassword, id } = res.json();
    expect(temporaryPassword).toHaveLength(24);

    const first = await login("cy@example.com", temporaryPassword);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ passwordChangeRequired: true });
    expect(first.json().accessToken).toBeUndefined();
    expect(first.cookies.find((c) => c.name === "ultimyr_rt")).toBeUndefined();
    const { changeToken } = first.json();

    const change = (payload: Record<string, unknown>) => h.app.inject({ method: "POST", url: "/v1/auth/change-password", payload });
    expect((await change({ changeToken, currentPassword: "wrong wrong wrong", newPassword: NEW_PASSWORD })).statusCode).toBe(401);
    expect((await change({ changeToken, currentPassword: temporaryPassword, newPassword: temporaryPassword })).statusCode).toBe(400);
    const ok = await change({ changeToken, currentPassword: temporaryPassword, newPassword: NEW_PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ email: "cy@example.com", roles: ["learner"] });

    // The old password is gone, the change token cannot be replayed, and the next sign-in is normal.
    expect((await login("cy@example.com", temporaryPassword)).statusCode).toBe(401);
    expect((await change({ changeToken, currentPassword: NEW_PASSWORD, newPassword: "yet another passphrase" })).statusCode).toBe(401);
    expect((await login("cy@example.com", NEW_PASSWORD)).json().accessToken).toBeTruthy();

    const list = (await h.app.inject({ url: "/v1/admin/users", headers: bearer(admin.accessToken) })).json();
    expect(list.find((u: { id: string }) => u.id === id)).toMatchObject({ createdVia: "local", mustChangePassword: false });
  });

  it("accepts an admin-chosen temporary password and checks its length", async () => {
    expect((await create({ email: "d@example.com", displayName: "D", method: "password", password: "short" })).statusCode).toBe(400);
    const ok = await create({ email: "d@example.com", displayName: "D", method: "password", password: "chosen by the admin" });
    expect(ok.json().temporaryPassword).toBe("chosen by the admin");
  });

  it("creates a user from a one-time invite link", async () => {
    const res = await create({ email: "eve@example.com", displayName: "Eve", method: "invite", roles: ["author", "learner"] });
    expect(res.statusCode).toBe(201);
    const { inviteUrl } = res.json();
    expect(inviteUrl).toMatch(/^http:\/\/localhost:3000\/set-password\?token=ulinv_/);
    const token = new URL(inviteUrl).searchParams.get("token")!;

    expect((await login("eve@example.com", NEW_PASSWORD)).statusCode).toBe(401);
    const set = (t: string) => h.app.inject({ method: "POST", url: "/v1/auth/set-password", payload: { token: t, password: NEW_PASSWORD } });
    expect((await set("ulinv_not-a-real-token")).statusCode).toBe(400);
    const ok = await set(token);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toBeTruthy();
    expect((await set(token)).statusCode).toBe(400);
    expect((await login("eve@example.com", NEW_PASSWORD)).statusCode).toBe(200);
  });

  it("rejects an expired invite and replaces it when reissued", async () => {
    const { id, inviteUrl } = (await create({ email: "fay@example.com", displayName: "Fay" })).json();
    const first = new URL(inviteUrl).searchParams.get("token")!;
    const reissued = await h.app.inject({ method: "POST", url: `/v1/admin/users/${id}/invite`, headers: bearer(admin.accessToken) });
    expect(reissued.statusCode).toBe(200);
    const second = new URL(reissued.json().inviteUrl).searchParams.get("token")!;
    const set = (t: string) => h.app.inject({ method: "POST", url: "/v1/auth/set-password", payload: { token: t, password: NEW_PASSWORD } });
    expect((await set(first)).statusCode).toBe(400);
    await h.pool.query("UPDATE auth.password_tokens SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
    expect((await set(second)).statusCode).toBe(400);
  });

  it("refuses duplicate emails (any case) and unknown roles", async () => {
    expect((await create({ email: "ADA@example.com", displayName: "Dup" })).statusCode).toBe(409);
    expect((await create({ email: "g@example.com", displayName: "G", roles: ["emperor"] })).statusCode).toBe(400);
    expect((await create({ email: "g@example.com", displayName: "G", roles: [] })).statusCode).toBe(400);
  });

  it("does not create a session for a suspended invitee", async () => {
    const { id, inviteUrl } = (await create({ email: "hal@example.com", displayName: "Hal" })).json();
    await h.app.inject({ method: "PATCH", url: `/v1/admin/users/${id}`, headers: bearer(admin.accessToken), payload: { status: "suspended" } });
    const token = new URL(inviteUrl).searchParams.get("token")!;
    expect((await h.app.inject({ method: "POST", url: "/v1/auth/set-password", payload: { token, password: NEW_PASSWORD } })).statusCode).toBe(400);
  });

  describe("disabling local users", () => {
    it("is off by default and cannot be switched on without an identity provider", async () => {
      expect((await h.app.inject({ url: "/v1/admin/settings", headers: bearer(admin.accessToken) })).json().localUsersDisabled).toBe(false);
      const refused = await setting({ localUsersDisabled: true });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error).toBe("no_identity_provider");
      expect((await setting({ localUsersDisabled: "yes" })).statusCode).toBe(400);
    });

    it("blocks password sign-in, sessions, sign-up and creation for local users, but keeps local admins as break-glass", async () => {
      const bob = (await register(h.app, "bob@example.com")).json();
      const bobCookie = (await login("bob@example.com", "correct horse battery")).cookies.find((c) => c.name === "ultimyr_rt")!.value;
      await addProvider();
      expect((await setting({ localUsersDisabled: true })).json().localUsersDisabled).toBe(true);

      // Existing local learner: password login, access token and refresh are all refused.
      const blocked = await login("bob@example.com", "correct horse battery");
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error).toBe("local_users_disabled");
      expect((await h.app.inject({ url: "/v1/me", headers: bearer(bob.accessToken) })).statusCode).toBe(401);
      expect((await h.app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: bobCookie } })).statusCode).toBe(401);
      // A wrong password still looks like any other failure.
      expect((await login("bob@example.com", "totally wrong password")).statusCode).toBe(401);

      // No new local accounts by any route.
      expect((await register(h.app, "new@example.com")).statusCode).toBe(403);
      expect((await create({ email: "new@example.com", displayName: "New" })).json().error).toBe("local_users_disabled");

      // The local administrator can still sign in and manage things.
      const ada = await login("ada@example.com", "correct horse battery");
      expect(ada.statusCode).toBe(200);
      expect((await h.app.inject({ url: "/v1/admin/overview", headers: bearer(ada.json().accessToken) })).statusCode).toBe(200);

      // Switching it off restores access.
      expect((await setting({ localUsersDisabled: false })).json().localUsersDisabled).toBe(false);
      expect((await login("bob@example.com", "correct horse battery")).statusCode).toBe(200);
    });

    it("does not block local accounts that are linked to an identity provider", async () => {
      const bob = (await register(h.app, "bob@example.com")).json();
      await addProvider();
      await h.pool.query(
        `INSERT INTO auth.identities (id, user_id, provider_id, subject) SELECT gen_random_uuid(), $1, id, 'sub-1' FROM auth.idp_providers LIMIT 1`,
        [bob.user.id],
      );
      await setting({ localUsersDisabled: true });
      expect((await h.app.inject({ url: "/v1/me", headers: bearer(bob.accessToken) })).statusCode).toBe(200);
    });
  });

  it("exports people as CSV for admins only, with formula-looking names neutralised", async () => {
    await create({ email: "e@example.com", displayName: "=HYPERLINK(\"x\")", method: "invite" });
    const csv = await h.app.inject({ url: "/v1/admin/users?format=csv", headers: bearer(admin.accessToken) });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")[0]).toBe("email,name,status,created_via,roles,created");
    expect(csv.body).toContain("e@example.com");
    expect(csv.body).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csv.body).not.toMatch(/password/i);
    expect((await h.app.inject({ url: "/v1/admin/users?limit=500", headers: bearer(admin.accessToken) })).statusCode).toBe(400);
    const learner = (await register(h.app, "learner@example.com")).json();
    expect((await h.app.inject({ url: "/v1/admin/users?format=csv", headers: bearer(learner.accessToken) })).statusCode).toBe(403);
  });
});
