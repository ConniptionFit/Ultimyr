import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("notes service", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const alice = uuid();
  const bob = uuid();
  const archive = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown, scopes?: string[]) =>
    h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u, scopes }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  const plan = {
    archiveTitle: "Claude Architect",
    slug: "claude-architect",
    stages: [{ title: "Foundations", steps: [{ id: uuid(), title: "Prep hub", url: "https://example.com/hub", children: [{ id: uuid(), title: "Lesson 1", url: null, children: [] }] }] }],
  };
  const stepId = plan.stages[0]!.steps[0]!.id;

  it("needs a token and the notes:use scope", async () => {
    expect((await h.app.inject({ url: "/v1/notes/connection" })).statusCode).toBe(401);
    expect((await call(alice, "GET", "/v1/notes/connection", undefined, ["quiz:read"])).statusCode).toBe(403);
    expect((await call(alice, "GET", "/v1/notes/connection", undefined, ["notes:use"])).statusCode).toBe(200);
  });

  it("starts disconnected and rejects bad tokens and unknown vaults", async () => {
    expect(json(await call(alice, "GET", "/v1/notes/connection"))).toMatchObject({ enabled: true, reason: null, server: "fns.test", connected: false, vault: null, admin: false, prefs: { rootFolder: "Ultimyr", editor: "ultimyr", pane: "split" } });
    expect((await call(alice, "PUT", "/v1/notes/connection", { token: "wrong-token-1", vault: "Study" })).statusCode).toBe(409);
    const r = await call(alice, "PUT", "/v1/notes/connection", { token: h.fake.state.token, vault: "Nope" });
    expect(r.statusCode).toBe(400);
    expect(json(r).vaults).toEqual(["Study"]);
  });

  it("lists the vaults a token can see before connecting", async () => {
    const ok = await call(alice, "POST", "/v1/notes/connection/check", { token: h.fake.state.token });
    expect(json(ok)).toEqual({ vaults: ["Study"] });
    expect((await call(alice, "POST", "/v1/notes/connection/check", { token: "wrong-token-1" })).statusCode).toBe(409);
  });

  it("connects, seals the token, and never returns it", async () => {
    const r = await call(alice, "PUT", "/v1/notes/connection", { token: h.fake.state.token, vault: "Study" });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(h.fake.state.token);
    const { rows } = await h.pool.query("SELECT sealed_token FROM notes.connections WHERE user_id = $1", [alice]);
    expect(rows[0].sealed_token.includes(Buffer.from(h.fake.state.token))).toBe(false);
    expect(json(await call(alice, "GET", "/v1/notes/connection"))).toMatchObject({ connected: true, vault: "Study" });
    expect(json(await call(bob, "GET", "/v1/notes/connection")).connected).toBe(false);
  });

  it("keeps preferences per person and cleans the folder name", async () => {
    expect(json(await call(alice, "GET", "/v1/notes/preferences"))).toEqual({ rootFolder: "Ultimyr", editor: "ultimyr", pane: "split" });
    const put = await call(alice, "PUT", "/v1/notes/preferences", { rootFolder: " /Study/Cert: Prep?/ ", editor: "obsidian", pane: "full" });
    expect(json(put)).toEqual({ rootFolder: "Study/Cert Prep", editor: "obsidian", pane: "full" });
    expect(json(await call(alice, "PUT", "/v1/notes/preferences", { pane: "off" }))).toEqual({ rootFolder: "Study/Cert Prep", editor: "obsidian", pane: "off" });
    expect((await call(alice, "PUT", "/v1/notes/preferences", { pane: "wide" })).statusCode).toBe(400);
    expect(json(await call(bob, "GET", "/v1/notes/preferences")).rootFolder).toBe("Ultimyr");
    await call(alice, "PUT", "/v1/notes/preferences", { rootFolder: "", editor: "ultimyr", pane: "split" });
    expect(json(await call(alice, "GET", "/v1/notes/preferences")).rootFolder).toBe("Ultimyr");
  });

  it("suggests folders that exist in the vault", async () => {
    const r = json(await call(alice, "GET", "/v1/notes/folders"));
    expect(r.folders).toEqual(expect.arrayContaining(["Daily", "Daily/2026", "Daily/2026/10", "Projects", "Projects/Alpha"]));
    expect(r.default).toBe("Ultimyr");
  });

  it("previews the tree in the chosen folder without writing anything", async () => {
    h.plans.set(`${alice}:${archive}`, plan);
    const before = h.fake.notes.size;
    const r = json(await call(alice, "GET", `/v1/notes/archives/${archive}/preview?root=${encodeURIComponent("Study/Prep")}`));
    expect(r.root).toBe("Study/Prep");
    expect(r.notes.map((n: { path: string }) => n.path)[0]).toBe("Study/Prep/claude-architect/00 Index.md");
    expect(r.total).toBe(3);
    expect(h.fake.notes.size).toBe(before);
    expect((await call(bob, "GET", `/v1/notes/archives/${archive}/preview`)).statusCode).toBe(404);
  });

  it("scaffolds notes without overwriting and is safe to repeat", async () => {
    h.plans.set(`${alice}:${archive}`, plan);
    const r = await call(alice, "POST", `/v1/notes/archives/${archive}/scaffold`);
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ total: 3, created: 3, existing: 0, failed: [] });
    const path = "Ultimyr/claude-architect/01 Foundations/01 Prep hub.md";
    expect(h.fake.notes.get(path)!.content).toContain(`ultimyr_step: ${stepId}`);

    h.fake.notes.get(path)!.content += "\nmy own words";
    const again = json(await call(alice, "POST", `/v1/notes/archives/${archive}/scaffold`));
    expect(again).toMatchObject({ created: 0, existing: 3, failed: [] });
    expect(h.fake.notes.get(path)!.content).toContain("my own words");

    const list = json(await call(alice, "GET", `/v1/notes/archives/${archive}`));
    expect(list.scaffolded).toBe(true);
    expect(list.steps[stepId].obsidianUrl).toContain("obsidian://open?vault=Study");
  });

  it("hides archives the caller cannot read", async () => {
    expect((await call(bob, "POST", `/v1/notes/archives/${archive}/scaffold`)).statusCode).toBe(409); // not connected
    await call(bob, "PUT", "/v1/notes/connection", { token: h.fake.state.token, vault: "Study" });
    expect((await call(bob, "POST", `/v1/notes/archives/${archive}/scaffold`)).statusCode).toBe(404);
  });

  it("reads and saves a step note with conflict protection", async () => {
    const got = json(await call(alice, "GET", `/v1/notes/steps/${stepId}`));
    expect(got).toMatchObject({ exists: true });
    expect(got.content).toContain("my own words");
    const saved = await call(alice, "PUT", `/v1/notes/steps/${stepId}`, { content: "# new", baseHash: got.hash });
    expect(saved.statusCode).toBe(200);
    const stale = await call(alice, "PUT", `/v1/notes/steps/${stepId}`, { content: "# lost", baseHash: got.hash });
    expect(stale.statusCode).toBe(409);
    expect(h.fake.notes.get("Ultimyr/claude-architect/01 Foundations/01 Prep hub.md")!.content).toBe("# new");
  });

  it("appends without replacing and lists flashcards", async () => {
    const path = "Ultimyr/claude-architect/01 Foundations/01 Prep hub.md";
    const cur = json(await call(alice, "GET", `/v1/notes/steps/${stepId}`));
    const base = "---\nstatus: todo\n---\n## Summary\nMine.\n\n## Flashcards\nWhat is a token? :: A chunk of text\n- Window size? :: Context limit\n";
    expect((await call(alice, "PUT", `/v1/notes/steps/${stepId}`, { content: base, baseHash: cur.hash })).statusCode).toBe(200);
    const r = await call(alice, "POST", `/v1/notes/steps/${stepId}/append`, { text: "## From Claude\nA suggestion." });
    expect(r.statusCode).toBe(200);
    const text = h.fake.notes.get(path)!.content;
    expect(text.startsWith(base.trimEnd())).toBe(true);
    expect(text).toContain("## From Claude\nA suggestion.");
    const cards = json(await call(alice, "GET", `/v1/notes/steps/${stepId}/flashcards`));
    expect(cards.cards).toEqual([
      { front: "What is a token?", back: "A chunk of text" },
      { front: "Window size?", back: "Context limit" },
    ]);
    expect((await call(bob, "POST", `/v1/notes/steps/${stepId}/append`, { text: "x" })).statusCode).toBe(404);
    expect((await call(alice, "POST", `/v1/notes/steps/${stepId}/append`, { text: "" })).statusCode).toBe(400);
  });

  it("keeps notes private to their owner", async () => {
    expect((await call(bob, "GET", `/v1/notes/steps/${stepId}`)).statusCode).toBe(404);
    expect((await call(bob, "PUT", `/v1/notes/steps/${stepId}`, { content: "x", baseHash: "h1" })).statusCode).toBe(404);
  });

  it("patches only the status property", async () => {
    const r = await call(alice, "POST", `/v1/notes/steps/${stepId}/status`, { status: "done" });
    expect(r.statusCode).toBe(200);
    expect(h.fake.state.patches.at(-1)).toMatchObject({ updates: { status: "done" } });
    expect((await call(alice, "POST", `/v1/notes/steps/${stepId}/status`, { status: "bogus" })).statusCode).toBe(400);
  });

  it("reports an unreachable or rejecting server plainly", async () => {
    h.fake.state.down = true;
    expect((await call(alice, "GET", `/v1/notes/steps/${stepId}`)).statusCode).toBe(502);
    h.fake.state.down = false;
    const old = h.fake.state.token;
    h.fake.state.token = "rotated-token-9";
    const r = await call(alice, "GET", `/v1/notes/steps/${stepId}`);
    expect(r.statusCode).toBe(409);
    expect(json(r).error).toBe("fns_token_rejected");
    h.fake.state.token = old;
  });

  it("disconnecting removes the connection and mapping but not notes", async () => {
    expect((await call(alice, "DELETE", "/v1/notes/connection")).statusCode).toBe(204);
    expect(json(await call(alice, "GET", "/v1/notes/connection")).connected).toBe(false);
    expect(h.fake.notes.size).toBe(3);
    expect(json(await call(alice, "GET", `/v1/notes/archives/${archive}`)).scaffolded).toBe(false);
  });
});

describe.skipIf(!testDbUrl)("administrator sets the server address in the web app", () => {
  it("works without any environment setting, and only for administrators", async () => {
    const h = await createHarness({ envUrl: null });
    const admin = uuid();
    const user = uuid();
    const as = async (u: string, roles?: string[]) => h.issuer.bearer({ userId: u, roles: roles as any });
    const call = async (u: string, method: string, url: string, payload?: unknown, roles?: string[]) => h.app.inject({ method: method as any, url, headers: await as(u, roles), ...(payload !== undefined ? { payload: payload as any } : {}) });
    const json = (r: { body: string }) => JSON.parse(r.body);

    expect(json(await call(user, "GET", "/v1/notes/connection"))).toMatchObject({ enabled: false, reason: "no_server", server: null });
    expect((await call(user, "POST", "/v1/notes/connection/check", { token: "abcdefgh1" })).statusCode).toBe(503);
    expect((await call(user, "GET", "/v1/notes/admin")).statusCode).toBe(403);
    expect((await call(user, "PUT", "/v1/notes/admin", { fnsUrl: "http://fns:9000" })).statusCode).toBe(403);

    const A = ["platform_admin"];
    expect(json(await call(admin, "GET", "/v1/notes/admin", undefined, A))).toEqual({ fnsUrl: null, source: null, keyPresent: true, canEdit: true });
    for (const bad of ["not a url", "ftp://x", "http://u:p@fns:9000", "http://fns:9000/?a=1"]) expect((await call(admin, "PUT", "/v1/notes/admin", { fnsUrl: bad }, A)).statusCode).toBe(400);
    h.fake.state.probeOk = false;
    expect(json(await call(admin, "PUT", "/v1/notes/admin", { fnsUrl: "http://fns:9000" }, A)).error).toBe("server_unreachable");
    h.fake.state.probeOk = true;
    expect(json(await call(admin, "PUT", "/v1/notes/admin", { fnsUrl: "http://fns:9000/" }, A))).toEqual({ fnsUrl: "http://fns:9000" });

    expect(json(await call(user, "GET", "/v1/notes/connection"))).toMatchObject({ enabled: true, reason: null, server: "fns:9000", admin: false });
    expect((await call(user, "PUT", "/v1/notes/connection", { token: h.fake.state.token, vault: "Study" })).statusCode).toBe(200);
    expect(json(await call(admin, "PUT", "/v1/notes/admin", { fnsUrl: null }, A))).toEqual({ fnsUrl: null });
    expect(json(await call(user, "GET", "/v1/notes/connection")).reason).toBe("no_server");
    await h.close();
  });

  it("an address in the environment wins and cannot be changed in the app", async () => {
    const h = await createHarness();
    const headers = await h.issuer.bearer({ userId: uuid(), roles: ["platform_admin"] });
    expect(JSON.parse((await h.app.inject({ url: "/v1/notes/admin", headers })).body)).toMatchObject({ fnsUrl: "http://fns.test", source: "env", canEdit: false });
    expect((await h.app.inject({ method: "PUT", url: "/v1/notes/admin", headers, payload: { fnsUrl: "http://other:9000" } })).statusCode).toBe(409);
    await h.close();
  });

  it("says the master key is missing when it is", async () => {
    const h = await createHarness({ enabled: false });
    const headers = await h.issuer.bearer({ userId: uuid(), roles: ["platform_admin"] });
    expect(JSON.parse((await h.app.inject({ url: "/v1/notes/connection", headers })).body)).toMatchObject({ enabled: false, reason: "no_key" });
    expect(JSON.parse((await h.app.inject({ url: "/v1/notes/admin", headers })).body).keyPresent).toBe(false);
    await h.close();
  });
});

describe.skipIf(!testDbUrl)("notes switched off", () => {
  it("answers 503 and reports disabled", async () => {
    const h = await createHarness({ enabled: false });
    const u = uuid();
    const headers = await h.issuer.bearer({ userId: u });
    expect(JSON.parse((await h.app.inject({ url: "/v1/notes/connection", headers })).body)).toMatchObject({ enabled: false, reason: "no_key", connected: false });
    expect((await h.app.inject({ method: "PUT", url: "/v1/notes/connection", headers, payload: { token: "abcdefgh1", vault: "x" } })).statusCode).toBe(503);
    await h.close();
  });
});
