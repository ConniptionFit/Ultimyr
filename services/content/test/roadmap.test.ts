import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeUrl, providerFor, guessKind, isSafeHttpsUrl } from "../src/links.js";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe("links", () => {
  it("normalizes, names providers and guesses kinds", () => {
    expect(normalizeUrl("https://WWW.Anthropic.com/learn/?utm_source=x&a=1")).toBe("https://www.anthropic.com/learn?a=1");
    expect(normalizeUrl("https://youtu.be/abc?si=zzz")).toBe("https://youtu.be/abc");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(providerFor("https://www.youtube.com/watch?v=1")).toBe("YouTube");
    expect(providerFor("https://anthropic.skilljar.com/x")).toBe("Anthropic Academy");
    expect(providerFor("https://www.example.org/x")).toBe("example.org");
    expect(guessKind("https://www.youtube.com/playlist?list=PL1")).toBe("playlist");
    expect(guessKind("https://youtu.be/abc")).toBe("video");
    expect(guessKind("https://example.com")).toBe("article");
  });
  it("only accepts plain https links", () => {
    for (const bad of ["http://example.com", "javascript:alert(1)", "https://u:p@example.com", "https://localhost", "not a url", "data:text/html,x"]) expect(isSafeHttpsUrl(bad)).toBe(false);
    expect(isSafeHttpsUrl("https://docs.example.com/a?b=1")).toBe(true);
  });
});

describe.skipIf(!testDbUrl)("roadmaps and resources", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const alice = uuid();
  const bob = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown, extra: { scopes?: string[] } = {}) =>
    h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u, ...extra }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function setup() {
    const archive = json(await call(alice, "POST", "/v1/archives", { title: `Claude Architect ${uuid().slice(0, 4)}`, visibility: "org" })).id as string;
    const guide = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "guide", title: "Foundations", markdown: "# Intro\nHello" })).id as string;
    return { archive, guide };
  }
  const yt = { url: "https://www.youtube.com/watch?v=abc123&utm_source=x", title: "Intro to Claude", minutes: 20 };

  it("adds resources, de-duplicates by link and fills in provider and kind", async () => {
    const { archive } = await setup();
    const a = await call(alice, "POST", `/v1/archives/${archive}/resources`, yt);
    expect(a.statusCode).toBe(201);
    expect(json(a)).toMatchObject({ kind: "video", provider: "YouTube", url: "https://www.youtube.com/watch?v=abc123", minutes: 20, status: "published" });
    const again = await call(alice, "POST", `/v1/archives/${archive}/resources`, { ...yt, title: "Renamed" });
    expect(again.statusCode).toBe(200);
    expect(json(again).id).toBe(json(a).id);
    const list = json(await call(alice, "GET", `/v1/archives/${archive}/resources`));
    expect(list.resources).toHaveLength(1);
    expect(list.resources[0].title).toBe("Renamed");
  });

  it("rejects unsafe links and enforces editor rights", async () => {
    const { archive } = await setup();
    for (const url of ["http://example.com/x", "javascript:alert(1)", "https://a:b@example.com"]) {
      expect((await call(alice, "POST", `/v1/archives/${archive}/resources`, { url, title: "x" })).statusCode).toBe(400);
    }
    expect((await call(bob, "POST", `/v1/archives/${archive}/resources`, yt)).statusCode).toBe(403);
    expect((await call(bob, "GET", `/v1/archives/${archive}/resources`)).statusCode).toBe(200);
    expect((await call(alice, "POST", `/v1/archives/${archive}/resources`, yt, { scopes: ["content:read"] })).statusCode).toBe(403);
  });

  it("keeps MCP and AI resources as drafts that only editors see", async () => {
    const { archive } = await setup();
    const r = await call(alice, "POST", `/v1/archives/${archive}/resources/bulk`, { source: "mcp", resources: [yt, { url: "https://docs.anthropic.com/en/docs/intro", title: "Docs", kind: "docs" }] });
    expect(r.statusCode).toBe(201);
    expect(json(r).resources.map((x: any) => x.status)).toEqual(["draft", "draft"]);
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/resources`)).resources).toHaveLength(0);
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/resources`)).resources).toHaveLength(2);
    const id = json(r).resources[0].id;
    expect((await call(bob, "GET", `/v1/resources/${id}`)).statusCode).toBe(404);
    expect((await call(alice, "PATCH", `/v1/resources/${id}`, { status: "published" })).statusCode).toBe(200);
    expect((await call(bob, "GET", `/v1/resources/${id}`)).statusCode).toBe(200);
  });

  it("builds a roadmap from items, resources and milestones, with totals and a next step", async () => {
    const { archive, guide } = await setup();
    const put = await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, {
      summary: "Six weeks to the exam",
      stages: [
        { title: "Week 1: Foundations", steps: [{ itemId: guide, minutes: 30 }, { resource: yt }, { resource: { url: "https://example.com/optional", title: "Extra reading", minutes: 10 }, required: false }] },
        { title: "Week 2: Practice", steps: [{ milestone: "Take a practice exam", note: "Aim for 70%" }] },
      ],
    });
    expect(put.statusCode).toBe(200);
    const v = json(put);
    expect(v.status).toBe("published");
    expect(v.stages.map((s: any) => s.steps.length)).toEqual([3, 1]);
    expect(v.totals).toMatchObject({ steps: 4, required: 3, done: 0, percent: 0, minutes: 60, minutesLeft: 50 });
    expect(v.next.title).toBe("Foundations");

    const view = json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`));
    expect(view.stages[0].steps[1].resource).toMatchObject({ provider: "YouTube", url: "https://www.youtube.com/watch?v=abc123" });

    const first = view.stages[0].steps[0].id;
    const tick = json(await call(bob, "PUT", `/v1/roadmap/steps/${first}/progress`, { done: true }));
    expect(tick.totals).toMatchObject({ done: 1, doneRequired: 1, percent: 33 });
    expect(tick.next.title).toBe("Intro to Claude");
    // Alice has her own, separate progress.
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/roadmap`)).totals.done).toBe(0);
    expect(json(await call(bob, "PUT", `/v1/roadmap/steps/${first}/progress`, { done: false })).totals.done).toBe(0);
  });

  it("keeps progress on steps whose ids are kept, and drops the rest", async () => {
    const { archive } = await setup();
    const v1 = json(await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { stages: [{ title: "One", steps: [{ resource: yt }, { milestone: "Check in" }] }] }));
    const [keep, drop] = v1.stages[0].steps;
    await call(bob, "PUT", `/v1/roadmap/steps/${keep.id}/progress`, { done: true });
    await call(bob, "PUT", `/v1/roadmap/steps/${drop.id}/progress`, { done: true });
    const v2 = json(await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { stages: [{ id: v1.stages[0].id, title: "One, renamed", steps: [{ id: keep.id, resourceId: keep.resource.id, note: "Updated" }] }] }));
    expect(v2.stages[0].steps).toHaveLength(1);
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`)).totals).toMatchObject({ steps: 1, doneRequired: 1, percent: 100 });
    expect((await call(bob, "PUT", `/v1/roadmap/steps/${drop.id}/progress`, { done: true })).statusCode).toBe(404);
  });

  it("rejects steps that point outside the archive", async () => {
    const one = await setup();
    const two = await setup();
    const r = await call(alice, "PUT", `/v1/archives/${one.archive}/roadmap`, { stages: [{ title: "x", steps: [{ itemId: two.guide }] }] });
    expect(r.statusCode).toBe(400);
    expect((await call(alice, "PUT", `/v1/archives/${one.archive}/roadmap`, { stages: [{ title: "x", steps: [{ milestone: "a", itemId: one.guide }] }] })).statusCode).toBe(400);
    expect((await call(alice, "PUT", `/v1/archives/${one.archive}/roadmap`, { stages: [{ title: "x", steps: [{}] }] })).statusCode).toBe(400);
  });

  it("holds MCP roadmaps as drafts until published, and hides draft targets from learners", async () => {
    const { archive, guide } = await setup();
    const put = json(await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { source: "mcp", stages: [{ title: "S", steps: [{ itemId: guide }] }] }));
    expect(put.status).toBe("draft");
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`)).exists).toBe(false);
    expect((await call(bob, "PUT", `/v1/roadmap/steps/${put.stages[0].steps[0].id}/progress`, { done: true })).statusCode).toBe(404);
    expect(json(await call(alice, "PATCH", `/v1/archives/${archive}/roadmap`, { status: "published" })).status).toBe("published");
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`)).totals.steps).toBe(1);
    // A draft guide disappears from the learner's view of the path but stays for editors.
    await call(alice, "PATCH", `/v1/items/${guide}`, { status: "draft" });
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`)).totals.steps).toBe(0);
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/roadmap`)).totals.steps).toBe(1);
  });

  it("deleting a resource removes it from the path", async () => {
    const { archive } = await setup();
    const v = json(await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { stages: [{ title: "S", steps: [{ resource: yt }] }] }));
    expect((await call(alice, "DELETE", `/v1/resources/${v.stages[0].steps[0].resource.id}`)).statusCode).toBe(204);
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/roadmap`)).totals.steps).toBe(0);
  });

  it("lists roadmaps with progress for the dashboard", async () => {
    const { archive } = await setup();
    const v = json(await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { stages: [{ title: "S", steps: [{ resource: yt }, { milestone: "m" }] }] }));
    await call(bob, "PUT", `/v1/roadmap/steps/${v.stages[0].steps[0].id}/progress`, { done: true });
    const list = json(await call(bob, "GET", "/v1/roadmaps")).roadmaps as any[];
    const mine = list.find((x) => x.archiveId === archive);
    expect(mine).toMatchObject({ started: true, totals: { percent: 50 }, next: { title: "m" } });
  });

  it("finds resources in search and round trips them through export and import", async () => {
    const { archive, guide } = await setup();
    await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, {
      summary: "Path",
      stages: [{ title: "S", steps: [{ itemId: guide, note: "Read first" }, { resource: { ...yt, summary: "Short orientation video about prompts" } }, { milestone: "Done" }] }],
    });
    const hits = json(await call(bob, "GET", "/v1/search?q=orientation&type=resource")).results;
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ type: "resource", url: "https://www.youtube.com/watch?v=abc123", archiveId: archive });

    const exp = json(await call(alice, "GET", `/v1/archives/${archive}/export`));
    expect(exp.resources).toHaveLength(1);
    expect(exp.roadmap.stages[0].steps).toMatchObject([{ itemIndex: 0, note: "Read first" }, { resourceUrl: "https://www.youtube.com/watch?v=abc123" }, { milestone: "Done" }]);
    const imp = await call(alice, "POST", "/v1/import", { format: "archive-json", content: exp });
    expect(imp.statusCode).toBe(201);
    const copy = json(await call(alice, "GET", `/v1/archives/${json(imp).archiveId}/roadmap`));
    expect(copy.summary).toBe("Path");
    expect(copy.stages[0].steps.map((s: any) => s.kind)).toEqual(["item", "resource", "milestone"]);
    expect(copy.stages[0].steps[1].resource.title).toBe("Intro to Claude");
  });
});
