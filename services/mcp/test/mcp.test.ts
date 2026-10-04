import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createTestIssuer } from "@ultimyr/service-kit/testing";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadMcpConfig } from "../src/config.js";
import { UpstreamError, type Upstream } from "../src/upstream.js";

const issuer = createTestIssuer();
const ID = "0198d6a0-0000-7000-8000-000000000001";
const ITEM = "0198d6a0-0000-7000-8000-000000000002";

interface Call { service: string; path: string; method: string; body: any; query: any; bearer: string }

describe("MCP server", () => {
  let app: FastifyInstance;
  let url: string;
  let calls: Call[];
  let respond: (c: Call) => any;
  const clients: Client[] = [];

  const upstream: Upstream = async (service, path, bearer, opts = {}) => {
    const c = { service, path, method: opts.method ?? "GET", body: opts.body, query: opts.query, bearer };
    calls.push(c);
    return respond(c);
  };

  async function boot(over: Record<string, string> = {}, fetchImpl?: typeof fetch) {
    app = await buildApp({ cfg: loadMcpConfig({ NODE_ENV: "test", ULTIMYR_PUBLIC_URL: "https://study.example.com", ...over }), keySource: issuer.publicKey, upstream, fetch: fetchImpl });
    url = await app.listen({ port: 0, host: "127.0.0.1" });
  }
  async function connect(token: string) {
    const c = new Client({ name: "test", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    clients.push(c);
    return c;
  }
  const text = (r: any) => r.content[0].text as string;

  beforeAll(() => undefined);
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
    await app?.close();
  });
  const fresh = () => {
    calls = [];
    respond = () => ({});
  };

  it("answers 401 with a pointer to its OAuth metadata, and publishes that metadata", async () => {
    fresh();
    await boot();
    const res = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="ultimyr", resource_metadata="https://study.example.com/.well-known/oauth-protected-resource"');
    const bad = await fetch(`${url}/mcp`, { method: "POST", headers: { authorization: "Bearer garbage", "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(401);
    const meta = await (await fetch(`${url}/.well-known/oauth-protected-resource`)).json();
    expect(meta).toMatchObject({ resource: "https://study.example.com/mcp", authorization_servers: ["https://study.example.com"] });
    expect(await (await fetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json()).toMatchObject({ resource: "https://study.example.com/mcp" });
    expect((await fetch(`${url}/mcp`)).status).toBe(405);
  });

  it("only offers the tools the connection's scopes allow", async () => {
    fresh();
    await boot();
    const names = async (scopes: string[]) => (await (await connect(await issuer.token({ scopes }))).listTools()).tools.map((t) => t.name).sort();
    const reader = await names(["content:read"]);
    expect(reader).toEqual(["get_archive", "get_coverage", "get_credentials", "get_deck", "get_guide", "get_objectives", "get_roadmap", "list_archives", "list_resources", "search_materials"]);
    const full = await names(["content:read", "content:write", "quiz:read", "quiz:write"]);
    expect(full).toContain("create_quiz_questions");
    expect(full).toContain("get_progress");
    expect(full).not.toContain("share_item");
    expect(await names(["content:read", "content:share"])).toContain("share_item");
    expect((await names([])).length).toBeGreaterThan(14); // an interactive token (no scope limit) sees everything
  });

  it("runs as the caller: their own token goes to the other services, and nothing else is trusted", async () => {
    fresh();
    await boot();
    const token = await issuer.token({ scopes: ["content:read"] });
    respond = () => ({ archives: [{ id: ID, title: "A+" }] });
    const c = await connect(token);
    const r = await c.callTool({ name: "list_archives", arguments: { query: "net" } });
    expect(JSON.parse(text(r))).toEqual({ archives: [{ id: ID, title: "A+" }] });
    expect(calls[0]).toMatchObject({ service: "content", path: "/v1/archives", bearer: token, query: { q: "net", limit: 25 } });
    // a scope the connection lacks is not callable, even by name
    const sneaky = await c.callTool({ name: "create_guide", arguments: { archiveId: ID, title: "x", markdown: "y" } }).catch((e) => e);
    expect(sneaky.isError ?? true).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("can create and rename an archive so material has somewhere to go", async () => {
    fresh();
    await boot();
    respond = (c) => ({ id: ID, title: "Claude Architect", slug: "claude-architect", visibility: "private", overview: "", vendor: null, tags: [] , path: c.path });
    const c = await connect(await issuer.token({ scopes: ["content:write"] }));
    const r = await c.callTool({ name: "create_archive", arguments: { title: "Claude Architect", overview: "Foundations" } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(text(r))).toMatchObject({ id: ID, visibility: "private" });
    expect(calls[0]).toMatchObject({ service: "content", path: "/v1/archives", method: "POST", body: { title: "Claude Architect", overview: "Foundations" } });
    await c.callTool({ name: "update_archive", arguments: { archiveId: ID, vendor: "Anthropic" } });
    expect(calls[1]).toMatchObject({ path: `/v1/archives/${ID}`, method: "PATCH", body: { vendor: "Anthropic" } });
  });

  it("writes land as MCP drafts", async () => {
    fresh();
    await boot();
    respond = (c) => (c.path.endsWith("/items") ? { id: ITEM, kind: "guide", title: "Ports", status: "draft", aiStatus: "none" } : {});
    const c = await connect(await issuer.token({ scopes: ["content:write"] }));
    const r = await c.callTool({ name: "create_guide", arguments: { archiveId: ID, title: "Ports", markdown: "# Ports\n\nHTTPS is 443." } });
    expect(r.isError).toBeFalsy();
    expect(calls[0]).toMatchObject({ service: "content", path: `/v1/archives/${ID}/items`, method: "POST", body: { kind: "guide", source: "mcp", title: "Ports" } });
    expect(JSON.parse(text(r))).toMatchObject({ id: ITEM, status: "draft" });

    fresh();
    respond = (c) => (c.path.endsWith("/items") ? { id: ITEM, kind: "quiz", title: "Q", status: "draft" } : {});
    const q = await c.callTool({ name: "create_quiz", arguments: { archiveId: ID, title: "Q" } });
    expect(q.isError).toBeFalsy();
    expect(calls[0]!.body.source).toBe("mcp");
  });

  it("adds links and sets a roadmap as drafts, and refuses unsafe input", async () => {
    fresh();
    await boot();
    respond = (c) => (c.path.endsWith("/resources/bulk") ? { resources: [{ id: ITEM, title: "Intro", provider: "YouTube", kind: "video", created: true }] } : { status: "draft", stages: [{ id: ID, title: "Week 1", progress: { done: 0, total: 1 }, steps: [{}] }], totals: { steps: 1 }, warnings: [] });
    const c = await connect(await issuer.token({ scopes: ["content:write"] }));
    const add = await c.callTool({ name: "add_resources", arguments: { archiveId: ID, resources: [{ url: "https://www.youtube.com/watch?v=abc", title: "Intro" }] } });
    expect(add.isError).toBeFalsy();
    expect(calls[0]).toMatchObject({ path: `/v1/archives/${ID}/resources/bulk`, method: "POST", body: { source: "mcp" } });
    const set = await c.callTool({ name: "set_roadmap", arguments: { archiveId: ID, stages: [{ title: "Week 1", steps: [{ resourceId: ITEM }, { milestone: "Quiz" }] }] } });
    expect(JSON.parse(text(set))).toMatchObject({ status: "draft" });
    expect(calls[1]).toMatchObject({ path: `/v1/archives/${ID}/roadmap`, method: "PUT", body: { source: "mcp", status: "draft" } });
    const outline = await c.callTool({ name: "import_outline", arguments: { archiveId: ID, outline: "## Week 1\n- [Hub](https://example.com/h) 30m\n  - [Lesson](https://youtu.be/x)" } });
    expect(outline.isError).toBeFalsy();
    expect(calls[2]).toMatchObject({ path: `/v1/archives/${ID}/roadmap/outline`, method: "POST", body: { source: "mcp", status: "draft", mode: "append" } });
    const nested = await c.callTool({ name: "set_roadmap", arguments: { archiveId: ID, stages: [{ title: "W", steps: [{ resource: { url: "https://example.com/h", title: "Hub" }, steps: [{ milestone: "Lesson" }] }] }] } });
    expect(nested.isError).toBeFalsy();
    expect(calls[3]!.body.stages[0].steps[0].steps[0].milestone).toBe("Lesson");
    const bad = await c.callTool({ name: "add_resources", arguments: { archiveId: ID, resources: [{ url: "not a url", title: "x" }] } }).catch((e) => e);
    expect(bad.isError ?? true).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("reads and appends to step notes only with the notes:use scope", async () => {
    fresh();
    await boot();
    const names = async (scopes: string[]) => (await (await connect(await issuer.token({ scopes }))).listTools()).tools.map((t) => t.name);
    expect(await names(["content:read", "content:write"])).not.toContain("get_step_note");
    expect((await names(["notes:use"])).sort()).toEqual(["append_step_note", "get_step_flashcards", "get_step_note"]);
    respond = (c) => (c.method === "POST" ? { path: "A/B.md", hash: "h" } : c.path.endsWith("/flashcards") ? { cards: [{ front: "q", back: "a" }], skipped: 0 } : { path: "A/B.md", exists: true, content: "# Note", hash: "h", obsidianUrl: "obsidian://x" });
    const c = await connect(await issuer.token({ scopes: ["notes:use"] }));
    const got = await c.callTool({ name: "get_step_note", arguments: { stepId: ID } });
    expect(JSON.parse(text(got))).toEqual({ path: "A/B.md", exists: true, content: "# Note" });
    expect(calls[0]).toMatchObject({ service: "notes", path: `/v1/notes/steps/${ID}` });
    const add = await c.callTool({ name: "append_step_note", arguments: { stepId: ID, text: "## From Claude\nHi" } });
    expect(add.isError).toBeFalsy();
    expect(calls[1]).toMatchObject({ service: "notes", path: `/v1/notes/steps/${ID}/append`, method: "POST", body: { text: "## From Claude\nHi" } });
    const cards = await c.callTool({ name: "get_step_flashcards", arguments: { stepId: ID } });
    expect(JSON.parse(text(cards)).cards).toEqual([{ front: "q", back: "a" }]);
  });

  it("holds edits to published material for review, and says so", async () => {
    fresh();
    await boot();
    respond = (c) => {
      if (c.method === "GET") return { id: ITEM, kind: "guide", title: "Ports", status: "published", markdown: "old" };
      if (c.method === "PATCH" && c.body.markdown) return { id: ITEM, kind: "guide", title: "Ports", status: "published" };
      return {};
    };
    const c = await connect(await issuer.token({ scopes: ["content:read", "content:write"] }));
    const r = await c.callTool({ name: "update_guide", arguments: { itemId: ITEM, markdown: "new" } });
    expect(JSON.parse(text(r))).toMatchObject({ status: "draft" });
    const patches = calls.filter((x) => x.method === "PATCH");
    expect(patches[0]!.body).toMatchObject({ markdown: "new", source: "mcp" });
    expect(patches[1]!.body).toMatchObject({ status: "draft" });

    fresh();
    respond = (x) => (x.method === "GET" ? { id: ITEM, kind: "guide", title: "Ports", status: "published" } : { id: ITEM, kind: "guide", title: "Ports", status: "published" });
    await c.callTool({ name: "update_guide", arguments: { itemId: ITEM, markdown: "new", holdForReview: false } });
    expect(calls.filter((x) => x.method === "PATCH")).toHaveLength(1);
  });

  it("refuses the wrong kind of item and sends quiz questions as drafts", async () => {
    fresh();
    await boot();
    respond = (c) => {
      if (c.method === "GET") return { id: ITEM, kind: "deck", title: "D", status: "published", cards: [] };
      return { questions: [{ id: "q1" }] };
    };
    const c = await connect(await issuer.token({ scopes: ["content:read", "quiz:write"] }));
    const wrong = await c.callTool({ name: "create_quiz_questions", arguments: { itemId: ITEM, questions: [{ type: "mcq", stem: "?", payload: { options: [{ id: "a", text: "x" }, { id: "b", text: "y" }] }, key: { correct: "a" } }] } });
    expect(wrong.isError).toBe(true);
    expect(text(wrong)).toContain("not a quiz");

    respond = (x) => (x.method === "GET" ? { id: ITEM, kind: "quiz", title: "Q", status: "draft" } : { questions: [{ id: "q1" }] });
    calls.length = 0;
    const good = await c.callTool({ name: "create_quiz_questions", arguments: { itemId: ITEM, questions: [{ type: "mcq", stem: "Port for HTTPS?", payload: { options: [{ id: "a", text: "443" }, { id: "b", text: "80" }] }, key: { correct: "a" } }] } });
    expect(good.isError).toBeFalsy();
    expect(calls.at(-1)).toMatchObject({ service: "quiz", path: `/v1/quizzes/${ITEM}/questions/bulk`, method: "POST" });
    expect(calls.at(-1)!.body.questions[0]).toMatchObject({ source: "mcp", type: "mcq" });
  });

  it("validates inputs before touching any service", async () => {
    fresh();
    await boot();
    const c = await connect(await issuer.token({ scopes: ["content:write"] }));
    const bad = await c.callTool({ name: "create_guide", arguments: { archiveId: "not-a-uuid", title: "", markdown: "" } }).catch((e) => e);
    expect(bad.isError ?? true).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("turns service errors into plain messages without leaking internals", async () => {
    fresh();
    await boot();
    const c = await connect(await issuer.token({ scopes: ["content:read"] }));
    for (const [status, code, expected] of [[404, "not_found", "Not found"], [403, "forbidden", "not allowed"], [401, "unauthenticated", "expired"], [503, "service_unavailable", "unavailable"], [409, "too_many_cards", "too many cards"]] as const) {
      respond = () => {
        throw new UpstreamError(status, code);
      };
      const r = await c.callTool({ name: "get_archive", arguments: { archiveId: ID } });
      expect(r.isError).toBe(true);
      expect(text(r).toLowerCase()).toContain(expected.toLowerCase());
    }
    respond = () => {
      throw new Error("pg: password authentication failed for user ultimyr at 10.0.0.5");
    };
    const r = await c.callTool({ name: "get_archive", arguments: { archiveId: ID } });
    expect(text(r)).not.toContain("10.0.0.5");
    expect(text(r)).not.toContain("password");
  });

  it("rate limits writes and whole requests per person", async () => {
    fresh();
    await boot({ MCP_WRITE_PER_MINUTE: "2", MCP_RATE_PER_MINUTE: "1000" });
    respond = () => ({ id: ITEM, kind: "quiz", title: "Q", status: "draft" });
    const c = await connect(await issuer.token({ scopes: ["content:write"], userId: "0198d6a0-0000-7000-8000-0000000000aa" }));
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await c.callTool({ name: "create_quiz", arguments: { archiveId: ID, title: `Q${i}` } }));
    expect(results.map((r) => !!r.isError)).toEqual([false, false, true, true]);
    expect(text(results[2])).toContain("Too many changes");
    expect(calls).toHaveLength(2);
    await app.close();

    await boot({ MCP_RATE_PER_MINUTE: "3" });
    const headers = { authorization: `Bearer ${await issuer.token({ scopes: [] })}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    const post = () => fetch(`${url}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    const statuses = [(await post()).status, (await post()).status, (await post()).status, (await post()).status];
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("accepts API keys by exchanging them at the auth service, briefly caching the result", async () => {
    fresh();
    let exchanges = 0;
    const scoped = await issuer.token({ scopes: ["content:read"], sessionId: "key:abc" });
    const fetchImpl = (async (input: any, init: any) => {
      expect(String(input)).toBe("http://localhost:4001/v1/auth/token");
      expect(init.headers.authorization).toBe("Bearer ulk_abcd1234_secretsecretsecretsecretsecretsecret");
      exchanges++;
      return new Response(JSON.stringify({ accessToken: scoped, expiresIn: 600 }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await boot({}, fetchImpl);
    const c = await connect("ulk_abcd1234_secretsecretsecretsecretsecretsecret");
    respond = () => ({ archives: [] });
    await c.callTool({ name: "list_archives", arguments: {} });
    await c.callTool({ name: "list_archives", arguments: {} });
    expect(calls[0]!.bearer).toBe(scoped);
    expect(exchanges).toBeLessThanOrEqual(3); // initialize, list tools, calls: cached after the first
    expect(exchanges).toBe(1);

    await app.close();
    const refusing = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await boot({}, refusing);
    const res = await fetch(`${url}/mcp`, { method: "POST", headers: { authorization: "Bearer ulk_abcd1234_secretsecretsecretsecretsecretsecret", "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("sets objectives by merge, links material and questions, and writes nothing without the scope", async () => {
    fresh();
    await boot();
    respond = (c) => (c.path.endsWith("/import") ? { added: 2, updated: 0, warnings: [], objectives: [{ id: ID, code: "1.0", title: "D", weightBp: 1500, children: [{ id: ITEM, code: "1.1", title: "O", counts: {} }] }] } : {});
    const c = await connect(await issuer.token({ scopes: ["content:write", "quiz:write"] }));
    const set = await c.callTool({ name: "set_objectives", arguments: { archiveId: ID, outline: "## 1.0 D (15%)\n- 1.1 O" } });
    expect(set.isError).toBeFalsy();
    expect(calls[0]).toMatchObject({ service: "content", path: `/v1/archives/${ID}/objectives/import`, method: "POST", body: { text: "## 1.0 D (15%)\n- 1.1 O", replace: false } });
    expect(JSON.parse(text(set)).objectives[0]).toEqual({ id: ID, code: "1.0", title: "D", weightBp: 1500, children: [{ id: ITEM, code: "1.1", title: "O" }] });
    await c.callTool({ name: "link_objectives", arguments: { archiveId: ID, links: [{ kind: "item", refId: ITEM, objectiveIds: [ID] }, { kind: "resource", refId: ITEM, objectiveIds: [] }] } });
    expect(calls.slice(1).map((x) => [x.path, x.method, x.body.kind])).toEqual([[`/v1/archives/${ID}/links`, "PUT", "item"], [`/v1/archives/${ID}/links`, "PUT", "resource"]]);
    await c.callTool({ name: "link_questions", arguments: { links: [{ questionId: ITEM, objectiveId: ID }, { questionId: ID, objectiveId: null }] } });
    expect(calls.slice(3).map((x) => [x.service, x.path, x.method, x.body.objectiveId])).toEqual([["quiz", `/v1/questions/${ITEM}`, "PATCH", ID], ["quiz", `/v1/questions/${ID}`, "PATCH", null]]);
    const bad = await c.callTool({ name: "link_objectives", arguments: { archiveId: ID, links: [{ kind: "quiz", refId: ITEM, objectiveIds: [] }] } }).catch((e) => e);
    expect(bad.isError ?? true).toBe(true);
    const reader = await connect(await issuer.token({ scopes: ["content:read"] }));
    const names = (await reader.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("set_objectives");
    expect(names).not.toContain("link_questions");
  });

  it("reports coverage by joining objectives with question stats, and copes without quiz access", async () => {
    fresh();
    await boot();
    const tree = [{ id: ID, code: "1.0", title: "Basics", weightBp: 10000, counts: { guides: 1, decks: 0, cards: 6, resources: 0 }, children: [
      { id: ITEM, code: "1.1", title: "One", weightBp: null, counts: { guides: 1, decks: 0, cards: 6, resources: 0 } },
      { id: "0198d6a0-0000-7000-8000-000000000003", code: "1.2", title: "Two", weightBp: null, counts: { guides: 0, decks: 0, cards: 0, resources: 0 } },
    ] }];
    respond = (c) => (c.service === "content" ? { objectives: tree } : { objectives: [{ objectiveId: ITEM, questions: 4, drafts: 0, answered: 5, correct: 2, accuracyBp: 4000 }], unmapped: { questions: 2, drafts: 0, answered: 0, correct: 0, accuracyBp: null } });
    const c = await connect(await issuer.token({ scopes: ["content:read", "quiz:read"] }));
    const r = JSON.parse(text(await c.callTool({ name: "get_coverage", arguments: { archiveId: ID } })));
    expect(calls.map((x) => [x.service, x.path])).toEqual([["content", `/v1/archives/${ID}/objectives`], ["quiz", "/v1/analytics/objectives"]]);
    expect(calls[1]!.query).toEqual({ archive: ID });
    expect(r.summary).toMatchObject({ objectives: 2, covered: 1, gap: 1, weak: 1, unmappedQuestions: 2 });
    expect(r.biggestGaps[0]).toMatchObject({ code: "1.2", status: "gap" });
    expect(r.rows[0].children[0]).toMatchObject({ status: "covered", mastery: "weak", accuracyBp: 4000 });

    fresh();
    respond = (x) => (x.service === "content" ? { objectives: tree } : {});
    const noQuiz = await connect(await issuer.token({ scopes: ["content:read"] }));
    const r2 = JSON.parse(text(await noQuiz.callTool({ name: "get_coverage", arguments: { archiveId: ID } })));
    expect(calls.map((x) => x.service)).toEqual(["content"]);
    expect(r2.summary.covered).toBe(0); // no questions known, so nothing counts as covered yet
    expect(r2.note).toContain("cannot read quizzes");
  });

  it("shows credentials without voucher codes, and fetches the countdown plan", async () => {
    fresh();
    await boot();
    respond = (x) => (x.service === "content" ? { alerts: [{ kind: "exam_soon" }], credentials: [{ id: ID, name: "A+", issuer: "CompTIA", status: "scheduled", examDate: "2026-10-14", voucherCode: "SECRET-123", voucherExpires: "2027-01-01", ceuRequired: null, ceuLogged: 0, ceuUnit: "CEU" }] } : { daysLeft: 10, days: [] });
    const c = await connect(await issuer.token({ scopes: ["content:read", "quiz:read"] }));
    const cr = text(await c.callTool({ name: "get_credentials", arguments: {} }));
    expect(cr).not.toContain("SECRET-123");
    expect(JSON.parse(cr)).toMatchObject({ alerts: [{ kind: "exam_soon" }], credentials: [{ name: "A+", hasVoucher: true, examDate: "2026-10-14" }] });
    const plan = JSON.parse(text(await c.callTool({ name: "get_exam_plan", arguments: { archiveId: ID, examDate: "2026-10-14", mode: "online" } })));
    expect(plan.daysLeft).toBe(10);
    expect(calls[1]).toMatchObject({ service: "quiz", path: "/v1/plan", query: { archive: ID, examDate: "2026-10-14", minutes: 45, mode: "online" } });
    const bad = await c.callTool({ name: "get_exam_plan", arguments: { archiveId: ID, examDate: "next week" } }).catch((e) => e);
    expect(bad.isError ?? true).toBe(true);
  });

  it("exposes resources and prompts", async () => {
    fresh();
    await boot();
    respond = (c) => (c.path === "/v1/archives" ? { archives: [{ id: ID, title: "A+" }] } : c.path.startsWith("/v1/items/") ? { id: ITEM, kind: "guide", title: "Ports", markdown: "# Ports" } : { id: ID, title: "A+", items: [] });
    const c = await connect(await issuer.token({ scopes: ["content:read", "quiz:read"] }));
    const templates = (await c.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate).sort();
    expect(templates).toEqual(["ultimyr://archive/{id}", "ultimyr://deck/{id}", "ultimyr://guide/{id}"]);
    const listed = await c.listResources();
    expect(listed.resources[0]).toMatchObject({ uri: `ultimyr://archive/${ID}`, name: "A+" });
    const guide = await c.readResource({ uri: `ultimyr://guide/${ITEM}` });
    expect(guide.contents[0]).toMatchObject({ mimeType: "text/markdown", text: "# Ports" });
    const prompts = (await c.listPrompts()).prompts.map((p) => p.name).sort();
    expect(prompts).toEqual(["build_roadmap", "explain_my_mistakes", "make_study_guide", "quiz_me_on"]);
    const p = await c.getPrompt({ name: "make_study_guide", arguments: { topic: "DNS" } });
    expect((p.messages[0]!.content as any).text).toContain("DNS");
    const noRead = await connect(await issuer.token({ scopes: ["quiz:read"] }));
    expect((await noRead.listResourceTemplates().catch(() => ({ resourceTemplates: [] }))).resourceTemplates).toHaveLength(0);
  });
});
