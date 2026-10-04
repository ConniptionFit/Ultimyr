import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, bearer, createHarness, register, testDbUrl, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("admin API and SCIM 2.0", () => {
  let h: Harness;
  let admin: string;
  let scim: string;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reset();
    await h.boot();
    admin = (await register(h.app, "admin@example.com")).json().accessToken;
    scim = (await h.app.inject({ method: "POST", url: "/v1/admin/scim-tokens", headers: bearer(admin), payload: { name: "okta" } })).json().token;
  });
  afterAll(() => h.close());

  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, token = scim) =>
    h.app.inject({
      method,
      url: `/scim/v2${url}`,
      headers: { ...bearer(token), ...(body !== undefined ? { "content-type": "application/scim+json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
  const newUser = (userName = "ada@example.com", extra: Record<string, unknown> = {}) =>
    call("POST", "/Users", {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName,
      externalId: "ext-1",
      name: { givenName: "Ada", familyName: "Lovelace" },
      emails: [{ value: userName, primary: true }],
      active: true,
      ...extra,
    });
  const patch = (path: string, ops: unknown[]) =>
    call("PATCH", path, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: ops });

  describe("authentication", () => {
    it("rejects missing, wrong, user and revoked tokens with SCIM error bodies", async () => {
      const none = await h.app.inject({ method: "GET", url: "/scim/v2/Users" });
      expect(none.statusCode).toBe(401);
      expect(none.json().schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:Error"]);
      expect((await call("GET", "/Users", undefined, "ulscim_wrong")).statusCode).toBe(401);
      expect((await call("GET", "/Users", undefined, admin)).statusCode).toBe(401); // a user JWT is not a SCIM token
      const { id } = (await h.app.inject({ url: "/v1/admin/scim-tokens", headers: bearer(admin) })).json()[0];
      await h.app.inject({ method: "DELETE", url: `/v1/admin/scim-tokens/${id}`, headers: bearer(admin) });
      expect((await call("GET", "/Users")).statusCode).toBe(401);
    });

    it("stores only a hash of the token and works under /api too", async () => {
      const { rows } = await h.pool.query("SELECT token_hash FROM auth.scim_tokens");
      expect(rows[0].token_hash).not.toContain(scim);
      const res = await h.app.inject({ url: "/api/scim/v2/ServiceProviderConfig", headers: bearer(scim) });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/scim+json");
      expect(res.json().patch.supported).toBe(true);
    });

    it("only platform admins can mint SCIM tokens", async () => {
      const user = (await register(h.app, "u@example.com")).json().accessToken;
      expect((await h.app.inject({ method: "POST", url: "/v1/admin/scim-tokens", headers: bearer(user), payload: { name: "x" } })).statusCode).toBe(403);
    });
  });

  describe("users", () => {
    it("creates a user, maps attributes, and refuses duplicates", async () => {
      const res = await newUser();
      expect(res.statusCode).toBe(201);
      const u = res.json();
      expect(u).toMatchObject({ userName: "ada@example.com", externalId: "ext-1", active: true, displayName: "Ada Lovelace" });
      expect(u.name).toMatchObject({ givenName: "Ada", familyName: "Lovelace" });
      expect(res.headers.location).toContain(`/scim/v2/Users/${u.id}`);
      expect((await newUser("ADA@example.com")).statusCode).toBe(409);
      expect((await newUser("ada2@example.com", { userName: "not-an-email" })).statusCode).toBe(400);
      const row = (await h.pool.query("SELECT created_via, password_hash FROM auth.users WHERE email = 'ada@example.com'")).rows[0];
      expect(row).toEqual({ created_via: "scim", password_hash: null });
    });

    it("lists with filters and pagination", async () => {
      await newUser("a@example.com", { externalId: "a" });
      await newUser("b@example.com", { externalId: "b" });
      await newUser("c@example.com", { externalId: "c" });
      const all = (await call("GET", "/Users?startIndex=1&count=2")).json();
      expect(all.totalResults).toBe(4); // admin + 3
      expect(all.Resources).toHaveLength(2);
      expect(all.itemsPerPage).toBe(2);
      const f = (await call("GET", `/Users?filter=${encodeURIComponent('userName eq "B@example.com"')}`)).json();
      expect(f.totalResults).toBe(1);
      expect(f.Resources[0].userName).toBe("b@example.com");
      const byExt = (await call("GET", `/Users?filter=${encodeURIComponent('externalId eq "c"')}`)).json();
      expect(byExt.Resources[0].userName).toBe("c@example.com");
      expect((await call("GET", `/Users?filter=${encodeURIComponent("userName co \"x\"")}`)).statusCode).toBe(400);
      expect((await call("GET", "/Users?count=0")).json().Resources).toEqual([]);
    });

    it("Okta-style deactivation (op replace active=false) revokes access immediately and blocks login", async () => {
      const id = (await newUser()).json().id;
      await h.pool.query("UPDATE auth.users SET password_hash = (SELECT password_hash FROM auth.users WHERE email = 'admin@example.com') WHERE id = $1", [id]);
      const login = await h.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "ada@example.com", password: PASSWORD } });
      expect(login.statusCode).toBe(200);
      const token = login.json().accessToken;

      const res = await patch(`/Users/${id}`, [{ op: "replace", value: { active: false } }]);
      expect(res.json().active).toBe(false);
      expect((await h.app.inject({ url: "/v1/me", headers: bearer(token) })).statusCode).toBe(401);
      expect((await h.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "ada@example.com", password: PASSWORD } })).statusCode).toBe(401);
      const { rows } = await h.pool.query("SELECT status FROM auth.users WHERE id = $1", [id]);
      expect(rows[0].status).toBe("deprovisioned");

      expect((await patch(`/Users/${id}`, [{ op: "replace", value: { active: true } }])).json().active).toBe(true);
    });

    it("Entra-style PATCH (path with capitalised ops, string booleans, emails path)", async () => {
      const id = (await newUser()).json().id;
      const a = await patch(`/Users/${id}`, [{ op: "Replace", path: "active", value: "False" }]);
      expect(a.json().active).toBe(false);
      const b = await patch(`/Users/${id}`, [
        { op: "Replace", path: "active", value: "True" },
        { op: "Replace", path: 'emails[type eq "work"].value', value: "ada.new@example.com" },
        { op: "Replace", path: "displayName", value: "Ada L." },
        { op: "Add", path: "name.givenName", value: "Augusta" },
      ]);
      expect(b.json()).toMatchObject({ active: true, userName: "ada.new@example.com", displayName: "Ada L." });
      expect(b.json().name.givenName).toBe("Augusta");
    });

    it("rejects changing userName to one already taken, and unsupported ops", async () => {
      const id = (await newUser()).json().id;
      await newUser("other@example.com", { externalId: "e2" });
      expect((await patch(`/Users/${id}`, [{ op: "replace", path: "userName", value: "other@example.com" }])).statusCode).toBe(409);
      expect((await patch(`/Users/${id}`, [{ op: "move", path: "userName", value: "x" }])).statusCode).toBe(400);
      expect((await call("PATCH", `/Users/${id}`, { nope: true })).statusCode).toBe(400);
    });

    it("PUT replaces the resource and DELETE removes the user", async () => {
      const id = (await newUser()).json().id;
      const put = await call("PUT", `/Users/${id}`, { userName: "ada@example.com", displayName: "Replaced", active: true });
      expect(put.json()).toMatchObject({ displayName: "Replaced" });
      expect(put.json().externalId).toBeUndefined();
      expect((await call("DELETE", `/Users/${id}`)).statusCode).toBe(204);
      expect((await call("GET", `/Users/${id}`)).statusCode).toBe(404);
      expect((await call("GET", "/Users/not-a-uuid")).statusCode).toBe(404);
    });
  });

  describe("groups", () => {
    it("creates groups with members and reflects them on users", async () => {
      const u1 = (await newUser("a@example.com", { externalId: "a" })).json().id;
      const u2 = (await newUser("b@example.com", { externalId: "b" })).json().id;
      const res = await call("POST", "/Groups", { displayName: "Engineering", externalId: "g1", members: [{ value: u1 }, { value: u2 }] });
      expect(res.statusCode).toBe(201);
      const g = res.json();
      expect(g.members.map((m: { value: string }) => m.value).sort()).toEqual([u1, u2].sort());
      expect((await call("GET", `/Users/${u1}`)).json().groups[0]).toMatchObject({ value: g.id, display: "Engineering" });
      expect((await call("POST", "/Groups", { displayName: "engineering" })).statusCode).toBe(409);
      expect((await call("POST", "/Groups", { displayName: "Bad", members: [{ value: "00000000-0000-0000-0000-000000000000" }] })).statusCode).toBe(400);
      const f = (await call("GET", `/Groups?filter=${encodeURIComponent('displayName eq "ENGINEERING"')}`)).json();
      expect(f.totalResults).toBe(1);
    });

    it("PATCH adds, removes (with and without filter) and replaces members", async () => {
      const ids: string[] = [];
      for (const n of ["a", "b", "c"]) ids.push((await newUser(`${n}@example.com`, { externalId: n })).json().id);
      const gid = (await call("POST", "/Groups", { displayName: "G" })).json().id;
      const members = async () => (await call("GET", `/Groups/${gid}`)).json().members.map((m: { value: string }) => m.value).sort();

      await patch(`/Groups/${gid}`, [{ op: "add", path: "members", value: [{ value: ids[0] }, { value: ids[1] }] }]);
      expect(await members()).toEqual([ids[0], ids[1]].sort());
      await patch(`/Groups/${gid}`, [{ op: "remove", path: `members[value eq "${ids[0]}"]` }]);
      expect(await members()).toEqual([ids[1]]);
      await patch(`/Groups/${gid}`, [{ op: "replace", path: "members", value: [{ value: ids[2] }] }]);
      expect(await members()).toEqual([ids[2]]);
      await patch(`/Groups/${gid}`, [{ op: "Add", value: { members: [{ value: ids[0] }] } }]);
      expect(await members()).toEqual([ids[0], ids[2]].sort());
      await patch(`/Groups/${gid}`, [{ op: "remove", path: "members", value: [{ value: ids[0] }] }]);
      expect(await members()).toEqual([ids[2]]);
      await patch(`/Groups/${gid}`, [{ op: "remove", path: "members" }]);
      expect(await members()).toEqual([]);
      const renamed = await patch(`/Groups/${gid}`, [{ op: "replace", path: "displayName", value: "Renamed" }]);
      expect(renamed.json().displayName).toBe("Renamed");
    });

    it("deleting a user removes them from groups; deleting a group keeps users", async () => {
      const u = (await newUser()).json().id;
      const gid = (await call("POST", "/Groups", { displayName: "G", members: [{ value: u }] })).json().id;
      await call("DELETE", `/Users/${u}`);
      expect((await call("GET", `/Groups/${gid}`)).json().members).toEqual([]);
      const u2 = (await newUser("z@example.com", { externalId: "z" })).json().id;
      await call("PATCH", `/Groups/${gid}`, { Operations: [{ op: "add", path: "members", value: [{ value: u2 }] }] });
      expect((await call("DELETE", `/Groups/${gid}`)).statusCode).toBe(204);
      expect((await call("GET", `/Users/${u2}`)).statusCode).toBe(200);
    });

    it("SCIM cannot touch local groups and admins cannot edit SCIM-owned groups", async () => {
      const local = (await h.app.inject({ method: "POST", url: "/v1/admin/groups", headers: bearer(admin), payload: { name: "Local" } })).json().id;
      expect((await call("GET", `/Groups/${local}`)).statusCode).toBe(404);
      const scimGroup = (await call("POST", "/Groups", { displayName: "Synced" })).json().id;
      const u = (await h.pool.query("SELECT id FROM auth.users WHERE email = 'admin@example.com'")).rows[0].id;
      const res = await h.app.inject({ method: "POST", url: `/v1/admin/groups/${scimGroup}/members`, headers: bearer(admin), payload: { userId: u } });
      expect(res.statusCode).toBe(409);
    });
  });

  describe("admin API", () => {
    it("lists users, requires admin, and protects the last active admin", async () => {
      const user = (await register(h.app, "u@example.com")).json();
      expect((await h.app.inject({ url: "/v1/admin/users", headers: bearer(user.accessToken) })).statusCode).toBe(403);
      const list = (await h.app.inject({ url: "/v1/admin/users?q=admin", headers: bearer(admin) })).json();
      expect(list).toHaveLength(1);
      expect(list[0].roles).toContain("platform_admin");

      const adminId = list[0].id;
      const demote = await h.app.inject({ method: "PATCH", url: `/v1/admin/users/${adminId}`, headers: bearer(admin), payload: { roles: ["author"] } });
      expect(demote.statusCode).toBe(409);
      const suspendSelf = await h.app.inject({ method: "PATCH", url: `/v1/admin/users/${adminId}`, headers: bearer(admin), payload: { status: "suspended" } });
      expect(suspendSelf.statusCode).toBe(409);

      // After promoting a second admin, the first can step down.
      await h.app.inject({ method: "PATCH", url: `/v1/admin/users/${user.user.id}`, headers: bearer(admin), payload: { roles: ["platform_admin", "author"] } });
      expect((await h.app.inject({ method: "PATCH", url: `/v1/admin/users/${adminId}`, headers: bearer(admin), payload: { roles: ["author"] } })).statusCode).toBe(200);
    });

    it("suspending a user revokes their sessions", async () => {
      const user = (await register(h.app, "u@example.com")).json();
      const res = await h.app.inject({ method: "PATCH", url: `/v1/admin/users/${user.user.id}`, headers: bearer(admin), payload: { status: "suspended" } });
      expect(res.json().status).toBe("suspended");
      expect((await h.app.inject({ url: "/v1/me", headers: bearer(user.accessToken) })).statusCode).toBe(401);
    });

    it("manages local groups and exposes membership to the user", async () => {
      const user = (await register(h.app, "u@example.com")).json();
      const g = (await h.app.inject({ method: "POST", url: "/v1/admin/groups", headers: bearer(admin), payload: { name: "Study group" } })).json();
      expect((await h.app.inject({ method: "POST", url: "/v1/admin/groups", headers: bearer(admin), payload: { name: "study GROUP" } })).statusCode).toBe(409);
      await h.app.inject({ method: "POST", url: `/v1/admin/groups/${g.id}/members`, headers: bearer(admin), payload: { userId: user.user.id } });
      const mine = (await h.app.inject({ url: "/v1/me/groups", headers: bearer(user.accessToken) })).json();
      expect(mine).toEqual([{ id: g.id, name: "Study group", source: "local" }]);
      await h.app.inject({ method: "DELETE", url: `/v1/admin/groups/${g.id}/members/${user.user.id}`, headers: bearer(admin) });
      expect((await h.app.inject({ url: "/v1/me/groups", headers: bearer(user.accessToken) })).json()).toEqual([]);
    });

    it("records security events in the audit log", async () => {
      await newUser();
      const log = (await h.app.inject({ url: "/v1/admin/audit?action=scim.user_created", headers: bearer(admin) })).json();
      expect(log).toHaveLength(1);
    });
  });
});
