import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseObjectives } from "../src/objective-outline.js";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe("objective outline", () => {
  it("reads domains with weights, codes and objectives", () => {
    const p = parseObjectives(`# Exam 220-1101
## 1.0 Mobile Devices (15%)
- 1.1 Install and configure laptop hardware
- 1.2 Compare display types
## Domain 2: Networking (20%)
2.1 Compare TCP and UDP
* **2.2** Configure SOHO networks
`);
    expect(p.warnings).toEqual([]);
    expect(p.domains.map((d) => [d.code, d.title, d.weightBp])).toEqual([["", "Exam 220-1101", null], ["1.0", "Mobile Devices", 1500], ["2", "Networking", 2000]].slice(0, 3));
    expect(p.domains[1]!.children).toEqual([
      { code: "1.1", title: "Install and configure laptop hardware", weightBp: null },
      { code: "1.2", title: "Compare display types", weightBp: null },
    ]);
    expect(p.domains[2]!.children.map((c) => [c.code, c.title])).toEqual([["2.1", "Compare TCP and UDP"], ["2.2", "Configure SOHO networks"]]);
  });

  it("makes a default domain when there are no headings and warns on odd weights", () => {
    const p = parseObjectives("- Prompt design\n- Tool use");
    expect(p.domains).toHaveLength(1);
    expect(p.domains[0]).toMatchObject({ title: "Objectives", children: [{ code: "", title: "Prompt design" }, { code: "", title: "Tool use" }] });
    expect(parseObjectives("## A (60%)\n- x\n## B (60%)\n- y").warnings[0]).toContain("120%");
    expect(parseObjectives("## A (150%)\n- x").warnings[0]).toContain("more than 100%");
  });
});

describe.skipIf(!testDbUrl)("objectives api", () => {
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

  async function setup(visibility = "org") {
    const archive = json(await call(alice, "POST", "/v1/archives", { title: `Exam ${uuid().slice(0, 4)}`, visibility })).id as string;
    const guide = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "guide", title: "Guide", markdown: "# Hi" })).id as string;
    const deck = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "deck", title: "Deck" })).id as string;
    await call(alice, "POST", `/v1/items/${deck}/cards`, { cards: [{ front: "a", back: "b" }, { front: "c", back: "d" }, { front: "e", back: "f" }] });
    const res = json(await call(alice, "POST", `/v1/archives/${archive}/resources`, { url: "https://example.com/r", title: "Read me" })).id as string;
    return { archive, guide, deck, res };
  }
  const outline = "## 1.0 Basics (60%)\n- 1.1 One\n- 1.2 Two\n## 2.0 More (40%)\n- 2.1 Three\n";

  it("imports an outline, merges on re-import and keeps ids", async () => {
    const { archive } = await setup();
    const first = await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: outline });
    expect(first.statusCode).toBe(200);
    expect(json(first)).toMatchObject({ added: 5, updated: 0 });
    const t = json(first).objectives;
    expect(t.map((d: any) => [d.code, d.weightBp, d.children.length])).toEqual([["1.0", 6000, 2], ["2.0", 4000, 1]]);
    const again = json(await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: `${outline}- 2.2 Four\n## 1.0 Basics renamed (60%)\n` }));
    expect(again.added).toBe(1);
    expect(again.objectives[0].id).toBe(t[0].id);
    expect(again.objectives[0].title).toBe("Basics renamed");
    expect(again.objectives[1].children.map((c: any) => c.code)).toEqual(["2.1", "2.2"]);
    const replaced = json(await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: "## A\n- a1", replace: true }));
    expect(replaced.objectives.map((d: any) => d.title)).toEqual(["A"]);
    expect((await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: "   \n\n" })).statusCode).toBe(400);
  });

  it("links material and counts it, rolling up to domains without double counting", async () => {
    const { archive, guide, deck, res } = await setup();
    const t = json(await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: outline })).objectives;
    const [o11, o12] = t[0].children as Array<{ id: string }>;
    const set = (kind: string, refId: string, objectiveIds: string[]) => call(alice, "PUT", `/v1/archives/${archive}/links`, { kind, refId, objectiveIds });
    expect((await set("item", guide, [o11!.id, o12!.id])).statusCode).toBe(200);
    await set("item", deck, [o11!.id]);
    await set("resource", res, [o12!.id]);
    const tree = json(await call(alice, "GET", `/v1/archives/${archive}/objectives`)).objectives;
    expect(tree[0].children[0].counts).toEqual({ guides: 1, decks: 1, cards: 3, resources: 0 });
    expect(tree[0].children[1].counts).toEqual({ guides: 1, decks: 0, cards: 0, resources: 1 });
    expect(tree[0].counts).toEqual({ guides: 1, decks: 1, cards: 3, resources: 1 }); // the guide supports two objectives but counts once
    expect(tree[1].counts).toEqual({ guides: 0, decks: 0, cards: 0, resources: 0 });
    const got = json(await call(alice, "GET", `/v1/archives/${archive}/links?kind=item&refId=${guide}`));
    expect(got.objectiveIds.sort()).toEqual([o11!.id, o12!.id].sort());
    await set("item", guide, [o11!.id]);
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/links?kind=item&refId=${guide}`)).objectiveIds).toEqual([o11!.id]);
  });

  it("links single cards and ignores drafts and deleted material", async () => {
    const { archive, guide, deck } = await setup();
    const o = json(await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: "## D\n- one" })).objectives[0].children[0].id as string;
    const cards = json(await call(alice, "GET", `/v1/items/${deck}/cards`)) as Array<{ id: string }>;
    await call(alice, "PUT", `/v1/archives/${archive}/links`, { kind: "card", refId: cards[0]!.id, objectiveIds: [o] });
    await call(alice, "PUT", `/v1/archives/${archive}/links`, { kind: "item", refId: guide, objectiveIds: [o] });
    const counts = async () => json(await call(alice, "GET", `/v1/archives/${archive}/objectives`)).objectives[0].children[0].counts;
    expect(await counts()).toEqual({ guides: 1, decks: 0, cards: 1, resources: 0 });
    await call(alice, "PATCH", `/v1/items/${guide}`, { status: "draft" });
    expect((await counts()).guides).toBe(0);
    await call(alice, "PATCH", `/v1/items/${guide}`, { status: "published" });
    await call(alice, "DELETE", `/v1/items/${guide}`);
    expect((await counts()).guides).toBe(0);
  });

  it("rejects links to other archives and objectives that are not in the archive", async () => {
    const a = await setup();
    const b = await setup();
    const oa = json(await call(alice, "POST", `/v1/archives/${a.archive}/objectives/import`, { text: "## D\n- one" })).objectives[0].children[0].id as string;
    const ob = json(await call(alice, "POST", `/v1/archives/${b.archive}/objectives/import`, { text: "## D\n- one" })).objectives[0].children[0].id as string;
    const put = (archive: string, body: unknown) => call(alice, "PUT", `/v1/archives/${archive}/links`, body);
    expect((await put(a.archive, { kind: "item", refId: b.guide, objectiveIds: [oa] })).statusCode).toBe(404);
    expect((await put(a.archive, { kind: "item", refId: a.guide, objectiveIds: [ob] })).statusCode).toBe(400);
    expect((await put(a.archive, { kind: "resource", refId: b.res, objectiveIds: [oa] })).statusCode).toBe(404);
    expect((await put(a.archive, { kind: "item", refId: uuid(), objectiveIds: [oa] })).statusCode).toBe(404);
    expect((await put(a.archive, { kind: "bogus", refId: a.guide, objectiveIds: [] })).statusCode).toBe(400);
  });

  it("saves a tree by id, moves objectives between domains and drops the rest", async () => {
    const { archive } = await setup();
    const t = json(await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: outline })).objectives;
    const keep = t[0].children[0].id as string;
    const put = await call(alice, "PUT", `/v1/archives/${archive}/objectives`, {
      objectives: [
        { id: t[1].id, code: "2.0", title: "More", weightBp: 4000, children: [{ id: keep, code: "1.1", title: "One, moved" }] },
        { code: "3.0", title: "New domain", children: [] },
      ],
    });
    expect(put.statusCode).toBe(200);
    const out = json(put).objectives;
    expect(out.map((d: any) => d.code)).toEqual(["2.0", "3.0"]);
    expect(out[0].children.map((c: any) => [c.id, c.title])).toEqual([[keep, "One, moved"]]);
    const bad = (objectives: unknown) => call(alice, "PUT", `/v1/archives/${archive}/objectives`, { objectives });
    expect((await bad([{ id: uuid(), code: "", title: "x", children: [] }])).statusCode).toBe(400);
    expect((await bad([{ id: keep, title: "a", children: [] }, { id: keep, title: "b", children: [] }])).statusCode).toBe(400);
    expect((await bad([{ title: "a", weightBp: 7000, children: [] }, { title: "b", weightBp: 7000, children: [] }])).statusCode).toBe(400);
    expect((await bad([{ title: "", children: [] }])).statusCode).toBe(400);
  });

  it("lets viewers read but only editors change, and hides archives people cannot see", async () => {
    const { archive } = await setup("org");
    await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: outline });
    expect((await call(bob, "GET", `/v1/archives/${archive}/objectives`)).statusCode).toBe(200);
    expect((await call(bob, "POST", `/v1/archives/${archive}/objectives/import`, { text: outline })).statusCode).toBe(403);
    expect((await call(bob, "PUT", `/v1/archives/${archive}/objectives`, { objectives: [] })).statusCode).toBe(403);
    expect((await call(bob, "PUT", `/v1/archives/${archive}/links`, { kind: "item", refId: uuid(), objectiveIds: [] })).statusCode).toBe(403);
    const priv = (await setup("private")).archive;
    expect((await call(bob, "GET", `/v1/archives/${priv}/objectives`)).statusCode).toBe(404);
    expect((await call(alice, "GET", `/v1/archives/${archive}/objectives`, undefined, { scopes: ["quiz:read"] })).statusCode).toBe(403);
  });

  it("reports which quizzes a person may attempt in an archive access check", async () => {
    const { archive } = await setup("org");
    const quiz = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "quiz", title: "Q", status: "draft" })).id as string;
    const mine = json(await call(alice, "GET", `/v1/access/archive/${archive}`));
    expect(mine.quizzes).toEqual([{ id: quiz, title: "Q", status: "draft", canAttempt: true, canWrite: true }]);
    expect(json(await call(bob, "GET", `/v1/access/archive/${archive}`)).quizzes).toEqual([]);
  });
});
