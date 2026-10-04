import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bearer, createHarness, register, testDbUrl, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("sharing directory", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot();
  });
  afterAll(() => h.close());

  it("finds a user only by exact email and reveals just id and name", async () => {
    const a = (await register(h.app, "ada@example.com", { displayName: "Ada" })).json();
    const b = (await register(h.app, "bob@example.com", { displayName: "Bob" })).json();
    const hit = await h.app.inject({ url: "/v1/users/lookup?email=BOB@example.com", headers: bearer(a.accessToken) });
    expect(hit.statusCode).toBe(200);
    expect(hit.json()).toEqual({ id: b.user.id, displayName: "Bob" });
    expect((await h.app.inject({ url: "/v1/users/lookup?email=nobody@example.com", headers: bearer(a.accessToken) })).statusCode).toBe(404);
    expect((await h.app.inject({ url: "/v1/users/lookup?email=bo", headers: bearer(a.accessToken) })).statusCode).toBe(400);
    expect((await h.app.inject({ url: "/v1/users/lookup?email=bob@example.com" })).statusCode).toBe(401);
  });

  it("does not resolve suspended users, and refuses API key tokens", async () => {
    const a = (await register(h.app, "ada@example.com")).json();
    const b = (await register(h.app, "bob@example.com")).json();
    await h.pool.query("UPDATE auth.users SET status = 'suspended' WHERE id = $1", [b.user.id]);
    expect((await h.app.inject({ url: "/v1/users/lookup?email=bob@example.com", headers: bearer(a.accessToken) })).statusCode).toBe(404);
    const key = (await h.app.inject({ method: "POST", url: "/v1/me/api-keys", headers: bearer(a.accessToken), payload: { name: "k", scopes: ["content:read"] } })).json().key;
    const tok = (await h.app.inject({ method: "POST", url: "/v1/auth/token", headers: bearer(key) })).json().accessToken;
    expect((await h.app.inject({ url: "/v1/users/lookup?email=ada@example.com", headers: bearer(tok) })).statusCode).toBe(403);
  });

  it("lists groups by name for signed-in users", async () => {
    const a = (await register(h.app, "ada@example.com")).json();
    await h.app.inject({ method: "POST", url: "/v1/admin/groups", headers: bearer(a.accessToken), payload: { name: "Helpdesk" } });
    const list = await h.app.inject({ url: "/v1/groups", headers: bearer(a.accessToken) });
    expect(list.json().map((g: any) => g.name)).toEqual(["Helpdesk"]);
    expect((await h.app.inject({ url: "/v1/groups" })).statusCode).toBe(401);
  });
});
