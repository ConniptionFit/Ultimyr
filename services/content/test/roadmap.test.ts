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
    expect(providerFor("https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification#ccarf-prep")).toBe("Anthropic Academy");
    expect(normalizeUrl("https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification#ccarf-prep")).toBe("https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification#ccarf-prep");
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

  it("nests steps: a course holds lessons, only lessons are ticked, and ticking the course ticks them all", async () => {
    const { archive, guide } = await setup();
    const v = json(
      await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, {
        stages: [
          {
            title: "Prep",
            steps: [
              {
                resource: { url: "https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification", title: "Prep hub", minutes: 90 },
                steps: [
                  { resource: { url: "https://youtu.be/one", title: "Lesson 1" }, minutes: 10, steps: [{ milestone: "Take notes" }] },
                  { resource: { url: "https://youtu.be/two", title: "Lesson 2" }, minutes: 20 },
                  { itemId: guide, required: false },
                ],
              },
              { milestone: "Practice exam" },
            ],
          },
        ],
      }),
    );
    const hub = v.stages[0].steps[0];
    expect(hub.resource.kind).toBe("course"); // a link with lessons under it is a course
    expect(hub.children).toHaveLength(3);
    expect(hub.children[0].children[0].title).toBe("Take notes");
    // Leaves: "Take notes", Lesson 2, the optional guide, "Practice exam".
    expect(v.totals).toMatchObject({ steps: 4, required: 3, done: 0 });
    expect(v.stages[0].progress).toEqual({ done: 0, total: 4 });

    const lesson2 = hub.children[1].id;
    let t = json(await call(bob, "PUT", `/v1/roadmap/steps/${lesson2}/progress`, { done: true }));
    expect(t.totals).toMatchObject({ done: 1, doneRequired: 1, required: 3 });
    let view = json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`));
    expect(view.stages[0].steps[0].done).toBe(false);
    expect(view.stages[0].steps[0].progress).toEqual({ done: 1, total: 3 });

    t = json(await call(bob, "PUT", `/v1/roadmap/steps/${hub.id}/progress`, { done: true }));
    expect(t.totals).toMatchObject({ done: 3, doneRequired: 2, required: 3 });
    view = json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`));
    expect(view.stages[0].steps[0].done).toBe(true); // everything required under it is done
    expect(view.stages[0].steps[0].children[0].done).toBe(true);
    expect(t.next.title).toBe("Practice exam");

    t = json(await call(bob, "PUT", `/v1/roadmap/steps/${hub.id}/progress`, { done: false }));
    expect(t.totals.done).toBe(0);
  });

  it("counts a course's own minutes only when its lessons carry none, and makes children of an optional parent optional", async () => {
    const { archive } = await setup();
    const v = json(
      await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, {
        stages: [
          { title: "A", steps: [{ resource: { url: "https://example.com/c1", title: "Untimed lessons", minutes: 60 }, steps: [{ milestone: "x" }, { milestone: "y" }] }] },
          { title: "B", steps: [{ resource: { url: "https://example.com/c2", title: "Timed", minutes: 999 }, steps: [{ milestone: "z", minutes: 5 }] }] },
          { title: "C", steps: [{ milestone: "Extra", required: false, steps: [{ milestone: "child" }] }] },
        ],
      }),
    );
    expect(v.totals).toMatchObject({ minutes: 65, minutesLeft: 65, required: 3, steps: 4 });
    expect(v.stages[0].steps[0].minutesTotal).toBe(60);
    expect(v.stages[1].steps[0].minutesTotal).toBe(5);
    expect(v.stages[2].steps[0].children[0].effectiveRequired).toBe(false);
    // Tick one of the two untimed lessons: half of the course's minutes are left.
    const x = v.stages[0].steps[0].children[0].id;
    const t = json(await call(bob, "PUT", `/v1/roadmap/steps/${x}/progress`, { done: true }));
    expect(t.totals.minutesLeft).toBe(30 + 5);
  });

  it("hides the children of a step a learner cannot see", async () => {
    const { archive, guide } = await setup();
    await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { stages: [{ title: "S", steps: [{ itemId: guide, steps: [{ milestone: "inside" }] }] }] });
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`)).totals.steps).toBe(1);
    await call(alice, "PATCH", `/v1/items/${guide}`, { status: "draft" });
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`)).totals.steps).toBe(0);
  });

  it("keeps progress when a step is moved under another parent, and rejects more than three levels", async () => {
    const { archive } = await setup();
    const v1 = json(await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { stages: [{ title: "S", steps: [{ milestone: "A" }, { milestone: "B", steps: [{ milestone: "leaf" }] }] }] }));
    const [a, b] = v1.stages[0].steps;
    const leaf = b.children[0];
    await call(bob, "PUT", `/v1/roadmap/steps/${leaf.id}/progress`, { done: true });
    const v2 = json(await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { stages: [{ id: v1.stages[0].id, title: "S", steps: [{ id: a.id, milestone: "A", steps: [{ id: leaf.id, milestone: "leaf" }] }, { id: b.id, milestone: "B" }] }] }));
    expect(v2.stages[0].steps[0].children[0].id).toBe(leaf.id);
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`)).stages[0].steps[0].children[0].done).toBe(true);
    const deep = { milestone: "1", steps: [{ milestone: "2", steps: [{ milestone: "3", steps: [{ milestone: "4" }] }] }] };
    expect((await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { stages: [{ title: "S", steps: [deep] }] })).statusCode).toBe(400);
  });

  it("imports an outline: appends by default, keeps progress, matches guides by title and reports problems", async () => {
    const { archive } = await setup();
    const first = await call(alice, "POST", `/v1/archives/${archive}/roadmap/outline`, { outline: "## Week 1\n- [Hub](https://example.com/hub) 30m\n  - [Lesson](https://youtu.be/x) 10m\n  - [[Foundations]]\n- [[No such guide]]\n- [Old](http://example.com)\n" });
    expect(first.statusCode).toBe(200);
    const v = json(first);
    expect(v.stages[0].steps[0].resource).toMatchObject({ kind: "course", minutes: 30 });
    expect(v.stages[0].steps[0].children.map((c: any) => c.kind)).toEqual(["resource", "item"]);
    expect(v.warnings).toHaveLength(2);
    const lesson = v.stages[0].steps[0].children[0].id;
    await call(bob, "PUT", `/v1/roadmap/steps/${lesson}/progress`, { done: true });

    const more = json(await call(alice, "POST", `/v1/archives/${archive}/roadmap/outline`, { outline: "## Week 2\n- Practice exam" }));
    expect(more.stages.map((s: any) => s.title)).toEqual(["Week 1", "Week 2"]);
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/roadmap`)).stages[0].steps[0].children[0].done).toBe(true);

    const replaced = json(await call(alice, "POST", `/v1/archives/${archive}/roadmap/outline`, { outline: "## Only\n- one", mode: "replace" }));
    expect(replaced.stages.map((s: any) => s.title)).toEqual(["Only"]);
    expect((await call(alice, "POST", `/v1/archives/${archive}/roadmap/outline`, { outline: "just words" })).statusCode).toBe(400);
    expect((await call(bob, "POST", `/v1/archives/${archive}/roadmap/outline`, { outline: "## x\n- y" })).statusCode).toBe(403);
    expect(json(await call(alice, "POST", `/v1/archives/${archive}/roadmap/outline`, { outline: "## x\n- y", source: "mcp" })).status).toBe("draft");
  });

  it("round trips a nested roadmap through export and import, keeping quiz steps as checkpoints", async () => {
    const { archive, guide } = await setup();
    const quiz = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "quiz", title: "Trial run" })).id as string;
    await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, {
      stages: [{ title: "S", steps: [{ resource: yt, steps: [{ itemId: guide }, { itemId: quiz, note: "Aim for 70%" }] }] }],
    });
    const exp = json(await call(alice, "GET", `/v1/archives/${archive}/export`));
    expect(exp.roadmap.stages[0].steps[0].steps).toMatchObject([{ itemIndex: 0 }, { milestone: "Trial run", note: "Aim for 70%" }]);
    const imp = json(await call(alice, "POST", "/v1/import", { format: "archive-json", content: exp }));
    const copy = json(await call(alice, "GET", `/v1/archives/${imp.archiveId}/roadmap`));
    const hub = copy.stages[0].steps[0];
    expect(hub.resource.title).toBe("Intro to Claude");
    expect(hub.children.map((c: any) => c.kind)).toEqual(["item", "milestone"]);
  });
});
