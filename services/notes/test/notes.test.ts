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
    expect(json(await call(alice, "GET", "/v1/notes/connection"))).toEqual({ enabled: true, server: "fns.test", connected: false, vault: null });
    expect((await call(alice, "PUT", "/v1/notes/connection", { token: "wrong-token-1", vault: "Study" })).statusCode).toBe(409);
    const r = await call(alice, "PUT", "/v1/notes/connection", { token: h.fake.state.token, vault: "Nope" });
    expect(r.statusCode).toBe(400);
    expect(json(r).vaults).toEqual(["Study"]);
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

describe.skipIf(!testDbUrl)("notes switched off", () => {
  it("answers 503 and reports disabled", async () => {
    const h = await createHarness({ enabled: false });
    const u = uuid();
    const headers = await h.issuer.bearer({ userId: u });
    expect(JSON.parse((await h.app.inject({ url: "/v1/notes/connection", headers })).body)).toMatchObject({ enabled: false, connected: false });
    expect((await h.app.inject({ method: "PUT", url: "/v1/notes/connection", headers, payload: { token: "abcdefgh1", vault: "x" } })).statusCode).toBe(503);
    await h.close();
  });
});
