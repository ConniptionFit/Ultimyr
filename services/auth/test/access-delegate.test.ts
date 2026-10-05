import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, bearer, createHarness, register, type Harness } from "./helpers.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("access_delegate role", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot({ AUTH_REGISTRATION: "open" });
  });
  afterAll(() => h.close());

  it("can be assigned by an admin, appears in the token, and grants no admin power", async () => {
    const admin = (await register(h.app, "ada@example.com")).json();
    const bob = (await register(h.app, "bob@example.com")).json();
    const patch = await h.app.inject({ method: "PATCH", url: `/v1/admin/users/${bob.user.id}`, headers: bearer(admin.accessToken), payload: { roles: ["learner", "access_delegate"] } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().roles.sort()).toEqual(["access_delegate", "learner"]);
    const { rows } = await h.pool.query("SELECT role FROM auth.role_assignments WHERE user_id = $1 ORDER BY role", [bob.user.id]);
    expect(rows.map((r) => r.role)).toEqual(["access_delegate", "learner"]);

    const login = await h.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "bob@example.com", password: PASSWORD } });
    const token = login.json().accessToken ?? bob.accessToken;
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(claims.roles).toContain("access_delegate");
    expect((await h.app.inject({ url: "/v1/admin/users", headers: bearer(token) })).statusCode).toBe(403);
  });
});
