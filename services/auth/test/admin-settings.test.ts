import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createHarness, register, testDbUrl, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("admin general settings", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot({ AUTH_REGISTRATION: "open" });
  });
  afterAll(() => h.close());

  it("keeps the overview and settings admin only", async () => {
    const admin = (await register(h.app, "ada@example.com")).json();
    const learner = (await register(h.app, "bob@example.com")).json();
    for (const url of ["/v1/admin/overview", "/v1/admin/settings", "/v1/admin/about"]) {
      expect((await h.app.inject({ url })).statusCode).toBe(401);
      expect((await h.app.inject({ url, headers: bearer(learner.accessToken) })).statusCode).toBe(403);
      expect((await h.app.inject({ url, headers: bearer(admin.accessToken) })).statusCode).toBe(200);
    }
    const denied = await h.app.inject({ method: "PATCH", url: "/v1/admin/settings", headers: bearer(learner.accessToken), payload: { registrationOpen: false } });
    expect(denied.statusCode).toBe(403);
  });

  it("reports counts", async () => {
    const admin = (await register(h.app, "ada@example.com")).json();
    await register(h.app, "bob@example.com");
    const o = (await h.app.inject({ url: "/v1/admin/overview", headers: bearer(admin.accessToken) })).json();
    expect(o.users).toEqual({ total: 2, active: 2, suspended: 0 });
    expect(o.admins).toBe(1);
  });

  it("lets an admin close registration, then fall back to the default", async () => {
    const admin = (await register(h.app, "ada@example.com")).json();
    const patch = (payload: Record<string, unknown>) => h.app.inject({ method: "PATCH", url: "/v1/admin/settings", headers: bearer(admin.accessToken), payload });
    const closed = await patch({ registrationOpen: false });
    expect(closed.json()).toMatchObject({ registrationOpen: false, registrationOverridden: true, registrationDefault: true });
    expect((await register(h.app, "bob@example.com")).statusCode).toBe(403);
    const reset = await patch({ registrationOpen: null });
    expect(reset.json()).toMatchObject({ registrationOpen: true, registrationOverridden: false });
    expect((await register(h.app, "bob@example.com")).statusCode).toBe(201);
    expect((await patch({ registrationOpen: "yes" })).statusCode).toBe(400);
  });
});

describe.skipIf(!testDbUrl)("admin audit log", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot({ AUTH_REGISTRATION: "open" });
  });
  afterAll(() => h.close());

  it("pages with before, lists action names and exports CSV", async () => {
    const admin = (await register(h.app, "ada@example.com")).json();
    const learner = (await register(h.app, "bob@example.com")).json();
    const headers = bearer(admin.accessToken);
    await h.pool.query("INSERT INTO auth.audit_log (action, target) VALUES ('test.one', '=cmd|calc'), ('test.two', 'a,\"b\"')");
    const all = (await h.app.inject({ url: "/v1/admin/audit?limit=2", headers })).json();
    expect(all).toHaveLength(2);
    const older = (await h.app.inject({ url: `/v1/admin/audit?limit=500&before=${all[1].id}`, headers })).json();
    expect(older.every((r: { id: number }) => r.id < all[1].id)).toBe(true);

    const actions = (await h.app.inject({ url: "/v1/admin/audit/actions", headers })).json();
    expect(actions).toEqual(expect.arrayContaining(["test.one", "test.two"]));

    const csv = await h.app.inject({ url: "/v1/admin/audit?format=csv&limit=5000", headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");
    expect(csv.body.split("\r\n")[0]).toBe("id,time,actor,action,target,address,details");
    expect(csv.body).toContain("'=cmd|calc");
    expect(csv.body).toContain('"a,""b"""');

    expect((await h.app.inject({ url: "/v1/admin/audit?limit=900", headers })).statusCode).toBe(400);
    for (const url of ["/v1/admin/audit?format=csv", "/v1/admin/audit/actions"]) {
      expect((await h.app.inject({ url, headers: bearer(learner.accessToken) })).statusCode).toBe(403);
    }
  });
});

describe.skipIf(!testDbUrl)("admin service status", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot({ AUTH_REGISTRATION: "open", CONTENT_URL: "http://127.0.0.1:9" });
  });
  afterAll(() => h.close());

  it("is admin only and lists auth plus configured services", async () => {
    const admin = (await register(h.app, "ada@example.com")).json();
    const learner = (await register(h.app, "bob@example.com")).json();
    expect((await h.app.inject({ url: "/v1/admin/services", headers: bearer(learner.accessToken) })).statusCode).toBe(403);
    const rows = (await h.app.inject({ url: "/v1/admin/services", headers: bearer(admin.accessToken) })).json();
    expect(rows[0]).toMatchObject({ name: "Auth", ok: true });
    expect(rows[1]).toMatchObject({ name: "Content", ok: false });
    expect(rows).toHaveLength(2);
  });
});
