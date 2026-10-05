import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("group access", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const admin = uuid();
  const curator = uuid();
  const alice = uuid();
  const member = uuid();
  const group = uuid();
  const other = uuid();
  const roles = { admin: ["platform_admin", "author", "learner"], curator: ["curriculum_admin", "learner"] };
  const call = async (userId: string, method: string, url: string, payload?: unknown, r?: string[]) =>
    h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId, ...(r ? { roles: r as any } : {}) }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);
  const mk = async (title: string, visibility = "private") => {
    const r = await call(alice, "POST", "/v1/archives", { title, visibility });
    expect(r.statusCode).toBe(201);
    return json(r).id as string;
  };

  it("lets an admin give a group view then manage access, and take it away", async () => {
    const id = await mk("Course A");
    h.groups.set(member, [group]);
    expect((await call(member, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);

    const view = await call(admin, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "view" }, roles.admin);
    expect(view.statusCode).toBe(200);
    expect((await call(member, "GET", `/v1/archives/${id}`)).statusCode).toBe(200);
    expect(json(await call(member, "GET", `/v1/archives/${id}`)).relation).toBe("viewer");

    await call(admin, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "manage" }, roles.admin);
    expect(json(await call(member, "GET", `/v1/archives/${id}`)).relation).toBe("editor");
    const { rows } = await h.pool.query("SELECT relation FROM content.grants WHERE object_id = $1 AND subject_id = $2", [id, group]);
    expect(rows).toEqual([{ relation: "editor" }]);

    const listed = json(await call(admin, "GET", `/v1/group-access/groups/${group}`, undefined, roles.admin));
    expect(listed.find((a: any) => a.archiveId === id)).toMatchObject({ title: "Course A", level: "manage", access: "restricted" });

    await call(admin, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "none" }, roles.admin);
    expect((await call(member, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);
  });

  it("keeps existing content visible: org archives stay open, and switching to restricted closes them", async () => {
    const id = await mk("Course B", "org");
    expect((await call(member, "GET", `/v1/archives/${id}`)).statusCode).toBe(200);
    const row = json(await call(admin, "GET", "/v1/group-access/archives", undefined, roles.admin)).find((a: any) => a.id === id);
    expect(row).toMatchObject({ access: "everyone", visibility: "org" });
    await call(admin, "PUT", `/v1/group-access/archives/${id}/access`, { mode: "restricted" }, roles.admin);
    expect((await call(member, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);
    await call(admin, "PUT", `/v1/group-access/archives/${id}/access`, { mode: "everyone" }, roles.admin);
    expect((await call(member, "GET", `/v1/archives/${id}`)).statusCode).toBe(200);
  });

  it("refuses everyone who is neither admin nor curriculum admin", async () => {
    const id = await mk("Course C");
    expect((await call(alice, "GET", "/v1/group-access/archives")).statusCode).toBe(403);
    expect((await call(alice, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "view" })).statusCode).toBe(403);
  });

  it("lets a curriculum admin create, edit, share and remove any course, and manage its group access", async () => {
    const mine = await mk("Alice's course");
    const created = await call(curator, "POST", "/v1/archives", { title: "Curator course" }, roles.curator);
    expect(created.statusCode).toBe(201);

    // Full access to a course someone else owns, including settings, items, sharing and removal.
    const got = json(await call(curator, "GET", `/v1/archives/${mine}`, undefined, roles.curator));
    expect(got.relation).toBe("owner");
    expect((await call(curator, "PATCH", `/v1/archives/${mine}`, { title: "Renamed", visibility: "org" }, roles.curator)).statusCode).toBe(200);
    expect((await call(curator, "PATCH", `/v1/archives/${mine}`, { visibility: "private" }, roles.curator)).statusCode).toBe(200);
    expect((await call(curator, "POST", `/v1/archives/${mine}/grants`, { subjectType: "group", subjectId: group, relation: "viewer" }, roles.curator)).statusCode).toBe(201);
    expect(json(await call(curator, "GET", "/v1/archives", undefined, roles.curator)).archives.map((a: any) => a.id)).toContain(mine);

    // Group access management reaches every course.
    const listed = json(await call(curator, "GET", "/v1/group-access/archives", undefined, roles.curator));
    expect(listed.map((a: any) => a.id)).toContain(mine);
    expect((await call(curator, "PUT", `/v1/group-access/archives/${mine}/groups/${group}`, { level: "manage" }, roles.curator)).statusCode).toBe(200);
    expect((await call(curator, "PUT", `/v1/group-access/archives/${mine}/access`, { mode: "everyone" }, roles.curator)).statusCode).toBe(200);

    // Trash and restore, then delete.
    expect((await call(curator, "DELETE", `/v1/archives/${mine}`, undefined, roles.curator)).statusCode).toBe(204);
    expect(json(await call(curator, "GET", "/v1/trash", undefined, roles.curator)).archives.map((a: any) => a.id)).toContain(mine);
    expect((await call(curator, "POST", `/v1/archives/${mine}/restore`, undefined, roles.curator)).statusCode).toBe(200);
  });

  it("gives plain authors and learners none of that", async () => {
    const id = await mk("Private to Alice");
    expect((await call(other, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);
    expect((await call(other, "GET", `/v1/archives/${id}`, undefined, ["learner"])).statusCode).toBe(404);
    expect(json(await call(other, "GET", "/v1/archives")).archives.map((a: any) => a.id)).not.toContain(id);
    expect((await call(other, "GET", "/v1/trash")).statusCode).toBe(200);
  });

  it("honours token scopes and rejects bad input", async () => {
    const id = await mk("Scopes");
    const ro = await h.app.inject({ method: "PUT", url: `/v1/group-access/archives/${id}/groups/${group}`, headers: await h.issuer.bearer({ userId: admin, roles: roles.admin as any, scopes: ["content:read"] }), payload: { level: "view" } });
    expect(ro.statusCode).toBe(403);
    expect((await call(admin, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "owner" }, roles.admin)).statusCode).toBe(400);
    expect((await call(admin, "PUT", `/v1/group-access/archives/not-a-uuid/groups/${group}`, { level: "view" }, roles.admin)).statusCode).toBe(404);
  });
});
