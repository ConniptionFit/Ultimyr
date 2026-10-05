import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("group access", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const admin = uuid();
  const delegate = uuid();
  const alice = uuid();
  const member = uuid();
  const group = uuid();
  const other = uuid();
  const roles = { admin: ["platform_admin", "author", "learner"], delegate: ["access_delegate", "learner"] };
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

  it("refuses everyone who is neither admin nor delegate", async () => {
    const id = await mk("Course C");
    expect((await call(alice, "GET", "/v1/group-access/archives")).statusCode).toBe(403);
    expect((await call(alice, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "view" })).statusCode).toBe(403);
    expect((await call(alice, "POST", `/v1/group-access/archives/${id}/delegates`, { userId: alice })).statusCode).toBe(403);
  });

  it("delegates manage group access only for archives delegated to them", async () => {
    const mine = await mk("Delegated");
    const notMine = await mk("Not delegated");
    expect((await call(admin, "POST", `/v1/group-access/archives/${mine}/delegates`, { userId: delegate }, roles.admin)).statusCode).toBe(201);
    expect(json(await call(admin, "GET", `/v1/group-access/delegates/${delegate}`, undefined, roles.admin))).toEqual([{ archiveId: mine, title: "Delegated" }]);

    const listed = json(await call(delegate, "GET", "/v1/group-access/archives", undefined, roles.delegate));
    expect(listed.map((a: any) => a.id)).toEqual([mine]);
    expect(json(await call(delegate, "GET", `/v1/group-access/groups/${group}`, undefined, roles.delegate)).map((a: any) => a.archiveId)).toEqual([mine]);

    expect((await call(delegate, "PUT", `/v1/group-access/archives/${mine}/groups/${group}`, { level: "view" }, roles.delegate)).statusCode).toBe(200);
    h.groups.set(member, [group]);
    expect((await call(member, "GET", `/v1/archives/${mine}`)).statusCode).toBe(200);
    expect((await call(delegate, "PUT", `/v1/group-access/archives/${notMine}/groups/${group}`, { level: "view" }, roles.delegate)).statusCode).toBe(404);

    // Not global settings: no visibility changes, no onward delegation, and no access to the content itself.
    expect((await call(delegate, "PUT", `/v1/group-access/archives/${mine}/access`, { mode: "everyone" }, roles.delegate)).statusCode).toBe(403);
    expect((await call(delegate, "POST", `/v1/group-access/archives/${mine}/delegates`, { userId: other }, roles.delegate)).statusCode).toBe(403);
    expect((await call(delegate, "GET", `/v1/archives/${mine}`, undefined, roles.delegate)).statusCode).toBe(404);

    // Removing the delegation removes the power.
    expect((await call(admin, "DELETE", `/v1/group-access/archives/${mine}/delegates/${delegate}`, undefined, roles.admin)).statusCode).toBe(204);
    expect((await call(delegate, "PUT", `/v1/group-access/archives/${mine}/groups/${group}`, { level: "none" }, roles.delegate)).statusCode).toBe(404);
  });

  it("does not let a delegate change an owner level group grant", async () => {
    const id = await mk("Owner grant");
    await h.pool.query("INSERT INTO content.grants (id, object_type, object_id, subject_type, subject_id, relation, created_by) VALUES ($1,'archive',$2,'group',$3,'owner',$4)", [uuid(), id, group, alice]);
    await call(admin, "POST", `/v1/group-access/archives/${id}/delegates`, { userId: delegate }, roles.admin);
    expect((await call(delegate, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "none" }, roles.delegate)).statusCode).toBe(403);
    expect((await call(admin, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "view" }, roles.admin)).statusCode).toBe(200);
  });

  it("honours token scopes and rejects bad input", async () => {
    const id = await mk("Scopes");
    const ro = await h.app.inject({ method: "PUT", url: `/v1/group-access/archives/${id}/groups/${group}`, headers: await h.issuer.bearer({ userId: admin, roles: roles.admin as any, scopes: ["content:read"] }), payload: { level: "view" } });
    expect(ro.statusCode).toBe(403);
    expect((await call(admin, "PUT", `/v1/group-access/archives/${id}/groups/${group}`, { level: "owner" }, roles.admin)).statusCode).toBe(400);
    expect((await call(admin, "PUT", `/v1/group-access/archives/not-a-uuid/groups/${group}`, { level: "view" }, roles.admin)).statusCode).toBe(404);
  });
});
