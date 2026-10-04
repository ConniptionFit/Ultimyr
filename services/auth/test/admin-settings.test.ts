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
    for (const url of ["/v1/admin/overview", "/v1/admin/settings"]) {
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
