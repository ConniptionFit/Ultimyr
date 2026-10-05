import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, bearer, createHarness, register, type Harness } from "./helpers.js";

describe.skipIf(!process.env.TEST_DATABASE_URL)("curriculum_admin role", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot({ AUTH_REGISTRATION: "open" });
  });
  afterAll(() => h.close());

  it("can be assigned by an admin, appears in the token, and grants no platform admin power", async () => {
    const admin = (await register(h.app, "ada@example.com")).json();
    const bob = (await register(h.app, "bob@example.com")).json();
    const patch = await h.app.inject({ method: "PATCH", url: `/v1/admin/users/${bob.user.id}`, headers: bearer(admin.accessToken), payload: { roles: ["learner", "curriculum_admin"] } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().roles.sort()).toEqual(["curriculum_admin", "learner"]);
    const { rows } = await h.pool.query("SELECT role FROM auth.role_assignments WHERE user_id = $1 ORDER BY role", [bob.user.id]);
    expect(rows.map((r) => r.role)).toEqual(["curriculum_admin", "learner"]);

    const login = await h.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "bob@example.com", password: PASSWORD } });
    const token = login.json().accessToken ?? bob.accessToken;
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(claims.roles).toContain("curriculum_admin");
    expect((await h.app.inject({ url: "/v1/admin/users", headers: bearer(token) })).statusCode).toBe(403);
  });

  it("migration 0007 moves existing access_delegate people to curriculum_admin", async () => {
    const bob = (await register(h.app, "bob@example.com")).json();
    // Put the database back in its 0006 state, then run the migration SQL again.
    await h.pool.query("ALTER TABLE auth.role_assignments DROP CONSTRAINT role_assignments_role_check");
    await h.pool.query("INSERT INTO auth.role_assignments (user_id, role) VALUES ($1, 'access_delegate')", [bob.user.id]);
    const sql = readFileSync(resolve(import.meta.dirname, "../migrations/0007_curriculum_admin_role.sql"), "utf8");
    await h.pool.query(sql);
    const { rows } = await h.pool.query("SELECT role FROM auth.role_assignments WHERE user_id = $1 ORDER BY role", [bob.user.id]);
    const roles = rows.map((r) => r.role);
    expect(roles).toContain("curriculum_admin");
    expect(roles).not.toContain("access_delegate");
  });
});
