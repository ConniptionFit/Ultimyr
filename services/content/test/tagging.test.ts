import { cpSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "@ultimyr/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("tags and icons", () => {
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

  async function setup(title = `Claude Architect ${uuid().slice(0, 4)}`) {
    const archive = json(await call(alice, "POST", "/v1/archives", { title, visibility: "org" })).id as string;
    return archive;
  }
  const roadmap = async (archive: string, stages: unknown[]) => {
    const r = await call(alice, "PUT", `/v1/archives/${archive}/roadmap`, { summary: "", stages });
    expect(r.statusCode).toBe(200);
    return json(r) as { stages: Array<{ id: string; icon: { name: string | null; source: string }; tagSet: string[]; steps: any[] }> };
  };

  it("serves the vocabulary and the whole icon library", async () => {
    expect((await h.app.inject({ url: "/v1/tags/vocabulary" })).statusCode).toBe(401);
    const vocab = json(await call(alice, "GET", "/v1/tags/vocabulary"));
    expect(vocab.namespaces.map((n: any) => n.namespace)).toEqual(["content-type", "topic", "level"]);
    expect(vocab.namespaces[1].values.find((v: any) => v.tag === "topic:ai").icons[0]).toBe("bot");

    const all = json(await call(alice, "GET", "/v1/icons?limit=5"));
    expect(all.totalInLibrary).toBeGreaterThan(1500);
    expect(all.total).toBe(all.totalInLibrary);
    expect(all.icons).toHaveLength(5);
    expect(json(await call(alice, "GET", "/v1/icons?query=robot")).icons.map((i: any) => i.name)).toContain("bot");
    expect(json(await call(alice, "GET", "/v1/icons?tag=ai&limit=1")).icons[0].name).toBe("bot");
    const bot = json(await call(alice, "GET", "/v1/icons/bot"));
    expect(bot.suggestFor.map((s: any) => s.tag)).toContain("topic:ai");
    expect((await call(alice, "GET", "/v1/icons/nope")).statusCode).toBe(404);
    expect((await call(alice, "GET", "/v1/icons?limit=9999")).statusCode).toBe(400);
    const s = json(await call(alice, "POST", "/v1/icons/suggest", { tags: ["networking", { tag: "security", weight: 0.5 }], limit: 3 }));
    expect(s.suggestions).toHaveLength(3);
    expect((await call(alice, "POST", "/v1/icons/suggest", { tags: [] })).statusCode).toBe(400);
  });

  it("stores normalized tags on archives, stages, steps and resources, and reads them back", async () => {
    const archive = await setup("Networking basics");
    const rm = await roadmap(archive, [{ title: "Cabling", steps: [{ resource: { url: "https://www.youtube.com/watch?v=net1", title: "Cat6 explained", summary: "Transcript and notes." } }, { milestone: "Check yourself" }] }]);
    const stage = rm.stages[0]!;
    const step = stage.steps[0];
    const resourceId = step.resource.id as string;

    const put = await call(alice, "PUT", `/v1/archives/${archive}/tags`, {
      targets: [
        { kind: "stage", id: stage.id, tags: ["Networking", "cabling", "type:Video", "networking", "ethernet"] },
        { kind: "resource", id: resourceId, tags: ["reading", "vendor:Acme"] },
        { kind: "archive", id: archive, tags: ["level:Beginner"] },
      ],
    });
    expect(put.statusCode).toBe(200);
    expect(json(put).stored[0].tags).toEqual(["topic:networking", "topic:cabling", "content-type:video"]);

    const got = json(await call(alice, "GET", `/v1/archives/${archive}/tags`));
    const byId = new Map<string, any>(got.targets.map((t: any) => [t.id, t]));
    expect(byId.get(stage.id).tags).toContain("topic:networking");
    // The link is a video; its text summary is tagged reading: the step carries both.
    const s = byId.get(step.id);
    expect(s.derived).toEqual(expect.arrayContaining(["content-type:video", "content-type:reading"]));
    expect(byId.get(resourceId).tags).toEqual(["content-type:reading", "vendor:acme"]);
    expect(got.summary.find((x: any) => x.tag === "content-type:video").count).toBeGreaterThanOrEqual(1);
    // Filters.
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/tags?kind=stage`)).targets).toHaveLength(1);
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/tags?tag=networking`)).targets.map((t: any) => t.id)).toContain(stage.id);
    // Read back through the roadmap too.
    const view = json(await call(alice, "GET", `/v1/archives/${archive}/roadmap`));
    expect(view.stages[0].tagSet).toContain("topic:networking");
    expect(view.stages[0].steps[0].resource.tagSet).toContain("content-type:reading");

    // Setting an empty list clears.
    await call(alice, "PUT", `/v1/archives/${archive}/tags`, { targets: [{ kind: "stage", id: stage.id, tags: [] }] });
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/roadmap`)).stages[0].tagSet).toEqual([]);
  });

  it("refuses targets from another archive, bad ids and readers", async () => {
    const a = await setup();
    const b = await setup();
    const rmB = await roadmap(b, [{ title: "Other", steps: [] }]);
    const bad = await call(alice, "PUT", `/v1/archives/${a}/tags`, { targets: [{ kind: "stage", id: rmB.stages[0]!.id, tags: ["ai"] }] });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).issues[0]).toContain("not part of this archive");
    expect((await call(alice, "PUT", `/v1/archives/${a}/tags`, { targets: [{ kind: "stage", id: "nope", tags: [] }] })).statusCode).toBe(400);
    expect((await call(alice, "PUT", `/v1/archives/${a}/tags`, { targets: [{ kind: "archive", id: a, tags: Array(31).fill("ai") }] })).statusCode).toBe(400);
    // Bob can read an org archive but not change tags or icons.
    expect((await call(bob, "GET", `/v1/archives/${a}/tags`)).statusCode).toBe(200);
    expect((await call(bob, "PUT", `/v1/archives/${a}/tags`, { targets: [{ kind: "archive", id: a, tags: ["ai"] }] })).statusCode).toBe(403);
    expect((await call(bob, "PUT", `/v1/archives/${a}/icons`, { targets: [{ kind: "archive", id: a, icon: "bot" }] })).statusCode).toBe(403);
    expect((await call(bob, "POST", `/v1/archives/${a}/icons/auto`)).statusCode).toBe(403);
    expect((await call(alice, "PUT", `/v1/archives/${a}/tags`, { targets: [{ kind: "archive", id: a, tags: ["ai"] }] }, { scopes: ["content:read"] })).statusCode).toBe(403);
  });

  it("picks icons from tags for archive, stages and steps, and ranks by matching tags", async () => {
    const archive = await setup("Applied AI");
    const rm = await roadmap(archive, [
      { title: "Agents and tools", steps: [{ milestone: "Build a tool using agents" }] },
      { title: "Subnetting and DNS", steps: [{ milestone: "Check yourself" }] },
      { title: "Welcome", steps: [] },
    ]);
    // Inferred from titles with no tags set: AI course, so a robot-like icon; networking stage gets a network icon.
    const arch = json(await call(alice, "GET", `/v1/archives/${archive}`));
    expect(arch.icon).toMatchObject({ kind: "lucide", name: "bot", source: "auto" });
    const [agents, net, welcome] = rm.stages;
    expect(agents!.icon.source).toBe("auto");
    expect(["bot", "workflow", "blocks", "plug"]).toContain(agents!.icon.name);
    expect(net!.icon).toMatchObject({ name: "network", source: "auto" });
    // A stage with nothing of its own to go on only borrows a faint signal from the course, which is not enough to pick an icon.
    expect(welcome!.icon).toMatchObject({ name: null, source: "none" });
    // Steps inherit from their stage.
    expect(rm.stages[0]!.steps[0].icon.source).toBe("auto");

    const sug = json(await call(alice, "GET", `/v1/archives/${archive}/icon-suggestions?kind=stage&id=${net!.id}&limit=5`));
    expect(sug.suggestions[0]).toMatchObject({ name: "network" });
    expect(sug.suggestions).toHaveLength(5);
    expect(sug.used.map((u: any) => u.tag)).toContain("topic:networking");
    const arSug = json(await call(alice, "GET", `/v1/archives/${archive}/icon-suggestions`));
    expect(arSug.suggestions[0].name).toBe("bot");

    // More matching tags move an icon up: add security to the networking stage.
    const before = sug.suggestions.map((s: any) => s.name);
    await call(alice, "PUT", `/v1/archives/${archive}/tags`, { targets: [{ kind: "stage", id: net!.id, tags: ["networking", "security", "firewall"] }] });
    const after = json(await call(alice, "GET", `/v1/archives/${archive}/icon-suggestions?kind=stage&id=${net!.id}&limit=8`)).suggestions.map((s: any) => s.name);
    expect(after).toEqual(expect.arrayContaining(["network", "shield-check"]));
    expect(after).not.toEqual(before);
  });

  it("never replaces an icon a person chose, and hands it back on null", async () => {
    const archive = await setup("Data work");
    const rm = await roadmap(archive, [{ title: "Networking and DNS", steps: [] }]);
    const stage = rm.stages[0]!;
    expect(stage.icon).toMatchObject({ name: "network", source: "auto" });

    const set = await call(alice, "PUT", `/v1/archives/${archive}/icons`, { targets: [{ kind: "stage", id: stage.id, icon: "rocket" }, { kind: "archive", id: archive, icon: "server" }] });
    expect(set.statusCode).toBe(200);
    // Changing tags and saving the roadmap again must leave both alone.
    await call(alice, "PUT", `/v1/archives/${archive}/tags`, { targets: [{ kind: "stage", id: stage.id, tags: ["ai"] }, { kind: "archive", id: archive, tags: ["databases"] }] });
    await call(alice, "PATCH", `/v1/archives/${archive}`, { title: "Machine learning with Claude" });
    const again = await roadmap(archive, [{ id: stage.id, title: "Neural networks", steps: [] }]);
    expect(again.stages[0]!.icon).toMatchObject({ name: "rocket", source: "user" });
    expect(json(await call(alice, "GET", `/v1/archives/${archive}`)).icon).toMatchObject({ name: "server", source: "user" });
    const auto = json(await call(alice, "POST", `/v1/archives/${archive}/icons/auto`));
    expect(auto.iconChanges).toEqual([]);

    // Handing back: stage returns to an automatic pick from its tags (ai).
    const back = json(await call(alice, "PUT", `/v1/archives/${archive}/icons`, { targets: [{ kind: "stage", id: stage.id, icon: null }, { kind: "archive", id: archive, icon: null }] }));
    expect(back.iconChanges.length).toBeGreaterThan(0);
    const view = json(await call(alice, "GET", `/v1/archives/${archive}/roadmap`));
    expect(view.stages[0].icon.source).toBe("auto");
    expect(["bot", "brain-circuit"]).toContain(view.stages[0].icon.name);
    expect(json(await call(alice, "GET", `/v1/archives/${archive}`)).icon.source).toBe("auto");

    // Unknown icons are refused.
    expect((await call(alice, "PUT", `/v1/archives/${archive}/icons`, { targets: [{ kind: "stage", id: stage.id, icon: "not-a-real-icon" }] })).statusCode).toBe(400);
    expect((await call(alice, "PATCH", `/v1/archives/${archive}`, { iconName: "not-a-real-icon" })).statusCode).toBe(400);
  });

  it("clears an automatic icon when nothing matches any more, and leaves untagged courses on the default", async () => {
    const archive = await setup("Zebra studies");
    expect(json(await call(alice, "GET", `/v1/archives/${archive}`)).icon).toMatchObject({ name: "book-open", source: "default" });
    await call(alice, "PUT", `/v1/archives/${archive}/tags`, { targets: [{ kind: "archive", id: archive, tags: ["security"] }] });
    expect(json(await call(alice, "GET", `/v1/archives/${archive}`)).icon).toMatchObject({ name: "shield-check", source: "auto" });
    await call(alice, "PUT", `/v1/archives/${archive}/tags`, { targets: [{ kind: "archive", id: archive, tags: ["vendor:acme"] }] });
    expect(json(await call(alice, "GET", `/v1/archives/${archive}`)).icon).toMatchObject({ name: "book-open", source: "default" });
  });

  it("hides draft material from readers when describing targets", async () => {
    const archive = await setup("Drafts");
    const r = json(await call(alice, "POST", `/v1/archives/${archive}/resources`, { url: "https://example.com/secret", title: "Draft video", kind: "video" }));
    await call(alice, "PATCH", `/v1/resources/${r.id}`, { status: "draft" });
    expect(json(await call(alice, "GET", `/v1/archives/${archive}/tags`)).targets.map((t: any) => t.id)).toContain(r.id);
    expect(json(await call(bob, "GET", `/v1/archives/${archive}/tags`)).targets.map((t: any) => t.id)).not.toContain(r.id);
  });

  it("tags exam objectives and carries linked objective topics to the material", async () => {
    const archive = await setup("Cert prep");
    await call(alice, "POST", `/v1/archives/${archive}/objectives/import`, { text: "## 1.0 Prompt engineering (30%)\n- 1.1 Write system prompts for agents" });
    const objs = json(await call(alice, "GET", `/v1/archives/${archive}/tags?kind=objective`)).targets as any[];
    expect(objs.length).toBeGreaterThan(0);
    expect(objs.flatMap((o) => o.inferred.map((i: any) => i.tag))).toContain("topic:prompt-engineering");
    const first = objs[0];
    expect((await call(alice, "PUT", `/v1/archives/${archive}/tags`, { targets: [{ kind: "objective", id: first.id, tags: ["ai"] }] })).statusCode).toBe(200);
  });

  it("applies cleanly to a database that already has content (upgrade)", async () => {
    const pool = new pg.Pool({ connectionString: testDbUrl });
    try {
      const dir = resolve(import.meta.dirname, "../migrations");
      const old = mkdtempSync(join(tmpdir(), "ulti-mig-"));
      for (const f of readdirSync(dir).filter((f) => f < "0008")) cpSync(join(dir, f), join(old, f));
      await pool.query("DROP SCHEMA IF EXISTS content CASCADE; DELETE FROM public.ultimyr_migrations WHERE service = 'content'");
      await migrate(pool, { service: "content", dir: old });
      const owner = uuid();
      const custom = uuid();
      const plain = uuid();
      const insert = `INSERT INTO content.master_items (id, owner_id, slug, title, overview, icon_name) VALUES ($1,$2,$3,'T','',$4)`;
      await pool.query(insert, [custom, owner, "a", "server"]);
      await pool.query(insert, [plain, owner, "b", "book-open"]);
      const applied = await migrate(pool, { service: "content", dir });
      expect(applied[0]).toBe("0008_tagging.sql");
      const { rows } = await pool.query("SELECT id, icon_source FROM content.master_items WHERE id = ANY($1::uuid[])", [[custom, plain]]);
      const src = Object.fromEntries(rows.map((r) => [r.id, r.icon_source]));
      // A custom icon stays the person's choice; the untouched default may be picked automatically.
      expect(src[custom]).toBe("user");
      expect(src[plain]).toBe("default");
      // Running it again does nothing.
      expect(await migrate(pool, { service: "content", dir })).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});
