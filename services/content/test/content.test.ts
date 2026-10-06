import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, makePng, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("content service", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const alice = uuid();
  const bob = uuid();
  const carol = uuid();
  const as = async (userId: string, extra: { roles?: any; scopes?: string[] } = {}) => h.issuer.bearer({ userId, ...extra });
  const call = async (userId: string, method: string, url: string, payload?: unknown, extra?: { roles?: any; scopes?: string[] }) =>
    h.app.inject({ method: method as any, url, headers: await as(userId, extra), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function newArchive(owner = alice, body: Record<string, unknown> = {}) {
    const r = await call(owner, "POST", "/v1/archives", { title: "CompTIA A+ Core 1", overview: "Hardware and networking.", ...body });
    expect(r.statusCode).toBe(201);
    return json(r).id as string;
  }

  it("requires authentication and refuses learners creating archives", async () => {
    expect((await h.app.inject({ url: "/v1/archives" })).statusCode).toBe(401);
    const learner = await call(alice, "POST", "/v1/archives", { title: "x" }, { roles: ["learner"] });
    expect(learner.statusCode).toBe(403);
  });

  it("serves the same routes under /api/v1", async () => {
    expect((await call(alice, "GET", "/api/v1/archives")).statusCode).toBe(200);
    expect((await h.app.inject({ url: "/healthz" })).statusCode).toBe(200);
  });

  it("creates, reads, updates and soft deletes an archive, with a restore", async () => {
    const id = await newArchive(alice, { vendor: "CompTIA", tags: ["it"], quickStats: { durationMinutes: 90, passingScore: "675" }, purchaseLinks: [{ label: "Voucher", url: "https://example.com/buy" }] });
    const got = json(await call(alice, "GET", `/v1/archives/${id}`));
    expect(got).toMatchObject({ title: "CompTIA A+ Core 1", relation: "owner", slug: "comptia-a-core-1", vendor: "CompTIA", quickStats: { durationMinutes: 90 } });
    const patched = await call(alice, "PATCH", `/v1/archives/${id}`, { title: "A+ Core 1 (220-1101)", validityMonths: 36 });
    expect(json(patched)).toMatchObject({ title: "A+ Core 1 (220-1101)", validityMonths: 36 });
    expect((await call(alice, "DELETE", `/v1/archives/${id}`)).statusCode).toBe(204);
    expect((await call(alice, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);
    const trash = json(await call(alice, "GET", "/v1/trash"));
    expect(trash.archives.map((a: any) => a.id)).toContain(id);
    expect((await call(alice, "POST", `/v1/archives/${id}/restore`)).statusCode).toBe(200);
    expect((await call(alice, "GET", `/v1/archives/${id}`)).statusCode).toBe(200);
  });

  it("validates input: bad links, bad icon names, unknown fields are ignored safely", async () => {
    expect((await call(alice, "POST", "/v1/archives", { title: "" })).statusCode).toBe(400);
    expect((await call(alice, "POST", "/v1/archives", { title: "x", purchaseLinks: [{ label: "bad", url: "javascript:alert(1)" }] })).statusCode).toBe(400);
    expect((await call(alice, "POST", "/v1/archives", { title: "x", iconName: "../../etc" })).statusCode).toBe(400);
    expect((await call(alice, "GET", "/v1/archives/not-a-uuid")).statusCode).toBe(404);
  });

  it("keeps private archives invisible to others, and never leaks existence", async () => {
    const id = await newArchive();
    expect((await call(bob, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);
    expect((await call(bob, "PATCH", `/v1/archives/${id}`, { title: "mine now" })).statusCode).toBe(404);
    expect((await call(bob, "DELETE", `/v1/archives/${id}`)).statusCode).toBe(404);
    const list = json(await call(bob, "GET", "/v1/archives"));
    expect(list.archives.map((a: any) => a.id)).not.toContain(id);
  });

  it("access matrix: viewer, editor and owner grants to users and groups, with expiry", async () => {
    const id = await newArchive();
    const item = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "Chapter 1", markdown: "# Ports\nUSB\n## Speeds\nfast" }));
    const group = uuid();
    h.groups.set(bob, [group]);

    // No access yet.
    expect((await call(bob, "GET", `/v1/items/${item.id}`)).statusCode).toBe(404);

    // Viewer via group.
    expect((await call(alice, "POST", `/v1/archives/${id}/grants`, { subjectType: "group", subjectId: group, relation: "viewer" })).statusCode).toBe(201);
    expect((await call(bob, "GET", `/v1/items/${item.id}`)).statusCode).toBe(200);
    expect((await call(bob, "PATCH", `/v1/items/${item.id}`, { title: "hacked" })).statusCode).toBe(403);
    expect((await call(bob, "DELETE", `/v1/archives/${id}`)).statusCode).toBe(403);
    expect((await call(bob, "GET", `/v1/archives/${id}/grants`)).statusCode).toBe(403);
    expect(json(await call(bob, "GET", `/v1/access/item/${item.id}`))).toMatchObject({ relation: "viewer", canRead: true, canWrite: false });

    // Editor via direct user grant on top: the best grant wins.
    await call(alice, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: bob, relation: "editor" });
    expect((await call(bob, "PATCH", `/v1/items/${item.id}`, { title: "Chapter One" })).statusCode).toBe(200);
    expect((await call(bob, "DELETE", `/v1/archives/${id}`)).statusCode).toBe(403);
    expect((await call(bob, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: carol, relation: "viewer" })).statusCode).toBe(403);

    // Owner grant lets bob reshare.
    await call(alice, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: bob, relation: "owner" });
    expect((await call(bob, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: carol, relation: "viewer" })).statusCode).toBe(201);
    expect((await call(carol, "GET", `/v1/archives/${id}`)).statusCode).toBe(200);

    // Revoking removes access.
    const grants = json(await call(alice, "GET", `/v1/archives/${id}/grants`));
    for (const g of grants.filter((x: any) => x.subjectId === carol)) expect((await call(alice, "DELETE", `/v1/archives/${id}/grants/${g.id}`)).statusCode).toBe(204);
    expect((await call(carol, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);
  });

  it("expired grants stop working", async () => {
    const id = await newArchive();
    await call(alice, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: carol, relation: "viewer", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect((await call(carol, "GET", `/v1/archives/${id}`)).statusCode).toBe(200);
    await h.pool.query("UPDATE content.grants SET expires_at = now() - interval '1 second' WHERE object_id = $1", [id]);
    expect((await call(carol, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);
    expect((await call(alice, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: carol, relation: "viewer", expiresAt: new Date(Date.now() - 1000).toISOString() })).statusCode).toBe(400);
  });

  it("item-level grants open one item, not the whole archive, and show the archive card", async () => {
    const id = await newArchive();
    const a = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "Shared guide", markdown: "# One\nhello" }));
    const b = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "Private guide", markdown: "# Two\nsecret" }));
    await call(alice, "POST", `/v1/items/${a.id}/grants`, { subjectType: "user", subjectId: carol, relation: "viewer" });
    expect((await call(carol, "GET", `/v1/items/${a.id}`)).statusCode).toBe(200);
    expect((await call(carol, "GET", `/v1/items/${b.id}`)).statusCode).toBe(404);
    const arch = json(await call(carol, "GET", `/v1/archives/${id}`));
    expect(arch.items.map((x: any) => x.id)).toEqual([a.id]);
    expect(json(await call(carol, "GET", "/v1/archives")).archives.map((x: any) => x.id)).toContain(id);
    // Search finds only what is readable.
    const hits = json(await call(carol, "GET", "/v1/search?q=secret"));
    expect(hits.results).toHaveLength(0);
    expect(json(await call(carol, "GET", "/v1/search?q=hello")).results.length).toBeGreaterThan(0);
  });

  it("attempt grants open quizzes only", async () => {
    const id = await newArchive();
    const quiz = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "quiz", title: "Practice exam" }));
    const guide = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "Notes", markdown: "x" }));
    await call(alice, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: carol, relation: "attempt" });
    expect(json(await call(carol, "GET", `/v1/access/item/${quiz.id}`))).toMatchObject({ canAttempt: true, canRead: false, kind: "quiz" });
    expect((await call(carol, "GET", `/v1/items/${guide.id}`)).statusCode).toBe(404);
  });

  it("org and public visibility give read access to any signed-in user", async () => {
    const id = await newArchive(alice, { visibility: "org" });
    expect((await call(carol, "GET", `/v1/archives/${id}`)).statusCode).toBe(200);
    expect((await call(carol, "PATCH", `/v1/archives/${id}`, { title: "no" })).statusCode).toBe(403);
    expect((await call(bob, "PATCH", `/v1/archives/${id}`, { visibility: "private" })).statusCode).toBe(403);
    await call(alice, "PATCH", `/v1/archives/${id}`, { visibility: "private" });
    expect((await call(carol, "GET", `/v1/archives/${id}`)).statusCode).toBe(404);
  });

  it("token scopes cap what an API key can do, even for the owner", async () => {
    const id = await newArchive();
    const ro = { scopes: ["content:read"] };
    expect((await call(alice, "GET", `/v1/archives/${id}`, undefined, ro)).statusCode).toBe(200);
    expect((await call(alice, "PATCH", `/v1/archives/${id}`, { title: "x" }, ro)).statusCode).toBe(403);
    expect((await call(alice, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: bob, relation: "viewer" }, { scopes: ["content:read", "content:write"] })).statusCode).toBe(403);
    expect((await call(alice, "GET", "/v1/archives", undefined, { scopes: ["quiz:read"] })).statusCode).toBe(403);
  });

  it("guides: versions, restore, sections and deep-link anchors", async () => {
    const id = await newArchive();
    const g = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "Networking", markdown: "Intro text\n\n# Ports\nUSB\n\n```\n# not a heading\n```\n\n## Speeds\nfast\n\n# Ports\nagain" }));
    expect(g.sections.map((s: any) => [s.heading, s.anchor])).toEqual([
      ["Introduction", "introduction"],
      ["Ports", "ports"],
      ["Speeds", "speeds"],
      ["Ports", "ports-2"],
    ]);
    expect(g.version.number).toBe(1);
    const up = json(await call(alice, "PATCH", `/v1/items/${g.id}`, { markdown: "# Only\nchanged", note: "rewrite" }));
    expect(up.version.number).toBe(2);
    expect(up.sections).toHaveLength(1);
    // Saving identical text does not create a version.
    expect(json(await call(alice, "PATCH", `/v1/items/${g.id}`, { markdown: "# Only\nchanged" })).version.number).toBe(2);
    const versions = json(await call(alice, "GET", `/v1/items/${g.id}/versions`));
    expect(versions.map((v: any) => v.number)).toEqual([2, 1]);
    expect((await call(alice, "POST", `/v1/items/${g.id}/versions/1/restore`)).statusCode).toBe(200);
    const now = json(await call(alice, "GET", `/v1/items/${g.id}`));
    expect(now.version).toMatchObject({ number: 3, source: "restore" });
    expect(now.markdown).toContain("Intro text");
    expect(json(await call(alice, "GET", `/v1/items/${g.id}/versions/2`)).body.markdown).toBe("# Only\nchanged");
  });

  it("AI and MCP writes land as drafts that only editors see, and publishing marks them reviewed", async () => {
    const id = await newArchive();
    const g = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "Generated", markdown: "# A\nx", source: "ai" }));
    expect(g).toMatchObject({ status: "draft", aiStatus: "draft" });
    await call(alice, "POST", `/v1/archives/${id}/grants`, { subjectType: "user", subjectId: carol, relation: "viewer" });
    expect((await call(carol, "GET", `/v1/items/${g.id}`)).statusCode).toBe(404);
    expect(json(await call(carol, "GET", `/v1/archives/${id}`)).items).toHaveLength(0);
    const pub = json(await call(alice, "PATCH", `/v1/items/${g.id}`, { status: "published" }));
    expect(pub).toMatchObject({ status: "published", aiStatus: "reviewed" });
    expect((await call(carol, "GET", `/v1/items/${g.id}`)).statusCode).toBe(200);
    const mcp = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "deck", title: "From MCP", source: "mcp", cards: [{ front: "q", back: "a" }] }));
    expect(mcp.status).toBe("draft");
  });

  it("decks: cards CRUD, ordering and versioned snapshots", async () => {
    const id = await newArchive();
    const d = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "deck", title: "Ports", cards: [{ front: "USB-C", back: "Reversible" }, { front: "HDMI", back: "Video", tags: ["video"] }] }));
    expect(d.cards.map((c: any) => c.front)).toEqual(["USB-C", "HDMI"]);
    const add = json(await call(alice, "POST", `/v1/items/${d.id}/cards`, { cards: [{ front: "DVI", back: "Old video" }, { id: d.cards[0].id, front: "USB-C", back: "Reversible, 24 pin" }] }));
    expect(add.ids).toHaveLength(2);
    const cards = json(await call(alice, "GET", `/v1/items/${d.id}/cards`));
    expect(cards.map((c: any) => c.front)).toEqual(["USB-C", "HDMI", "DVI"]);
    expect(cards[0].back).toBe("Reversible, 24 pin");
    expect((await call(alice, "PATCH", `/v1/cards/${cards[1].id}`, { hint: "Think TV" })).statusCode).toBe(200);
    expect(json(await call(alice, "POST", `/v1/items/${d.id}/cards/delete`, { ids: [cards[2].id] })).deleted).toBe(1);
    const versions = json(await call(alice, "GET", `/v1/items/${d.id}/versions`));
    expect(versions.length).toBeGreaterThanOrEqual(4);
    // Restoring the first snapshot brings back the original two cards.
    expect((await call(alice, "POST", `/v1/items/${d.id}/versions/1/restore`)).statusCode).toBe(200);
    const after = json(await call(alice, "GET", `/v1/items/${d.id}/cards`));
    expect(after.map((c: any) => c.front)).toEqual(["USB-C", "HDMI"]);
    expect(after[0].back).toBe("Reversible");
    // Strangers cannot touch cards by id.
    expect((await call(bob, "PATCH", `/v1/cards/${after[0].id}`, { front: "x" })).statusCode).toBe(404);
  });

  it("cards are capped per deck", async () => {
    const id = await newArchive();
    const d = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "deck", title: "Big" }));
    const batch = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ front: `${p}${i}`, back: "b" }));
    for (let i = 0; i < 10; i++) expect((await call(alice, "POST", `/v1/items/${d.id}/cards`, { cards: batch(500, `r${i}-`) })).statusCode).toBe(201);
    expect((await call(alice, "POST", `/v1/items/${d.id}/cards`, { cards: batch(1, "extra") })).statusCode).toBe(409);
  });

  it("search covers archives, items, guide sections and cards, ranked, with snippets", async () => {
    const id = await newArchive(alice, { title: "Quantum Networking", overview: "Entanglement basics" });
    await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "Photons", markdown: "# Polarization\nPhotons carry polarization state." });
    await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "deck", title: "Terms", cards: [{ front: "Qubit", back: "A quantum bit" }] });
    const r1 = json(await call(alice, "GET", "/v1/search?q=polarization"));
    expect(r1.results[0]).toMatchObject({ type: "section", anchor: "polarization" });
    expect(r1.results[0].snippet).toContain("<b>");
    const r2 = json(await call(alice, "GET", "/v1/search?q=qubit"));
    expect(r2.results[0].type).toBe("card");
    const r3 = json(await call(alice, "GET", "/v1/search?q=entanglement&type=archive"));
    expect(r3.results[0]).toMatchObject({ type: "archive", id });
    expect((await call(alice, "GET", "/v1/search?q=")).statusCode).toBe(400);
    // Other users see nothing until shared.
    expect(json(await call(bob, "GET", "/v1/search?q=polarization")).results).toHaveLength(0);
  });

  it("uploads a PNG icon, strips metadata, and rejects bad files", async () => {
    const id = await newArchive();
    const post = async (body: Buffer, type = "image/png") =>
      h.app.inject({ method: "POST", url: `/v1/archives/${id}/icon`, headers: { ...(await as(alice)), "content-type": type }, payload: body });
    const good = await makePng({ withText: true });
    expect(good.includes(Buffer.from("secret-location-data"))).toBe(true);
    const res = await post(good);
    expect(res.statusCode).toBe(200);
    const { url } = json(res);
    const served = await h.app.inject({ url: url.replace("/api", "") });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.rawPayload.includes(Buffer.from("secret-location-data"))).toBe(false);
    expect(json(await call(alice, "GET", `/v1/archives/${id}`)).icon).toMatchObject({ kind: "upload" });
    expect((await post(await makePng({ colorType: 2 }))).statusCode).toBe(400); // no alpha
    expect(json(await post(await makePng({ colorType: 2 }))).error).toBe("icon_needs_transparency");
    expect((await post(await makePng({ size: 8 }))).statusCode).toBe(400);
    expect((await post(Buffer.from("GIF89a-not-a-png-at-all-just-text-padding-padding"))).statusCode).toBe(400);
    expect((await post(good, "image/jpeg")).statusCode).toBeGreaterThanOrEqual(400);
    // Others cannot replace it.
    const other = await h.app.inject({ method: "POST", url: `/v1/archives/${id}/icon`, headers: { ...(await as(bob)), "content-type": "image/png" }, payload: good });
    expect(other.statusCode).toBe(404);
    // Switching back to a Lucide icon clears the upload.
    await call(alice, "PATCH", `/v1/archives/${id}`, { iconName: "server" });
    expect(json(await call(alice, "GET", `/v1/archives/${id}`)).icon).toMatchObject({ kind: "lucide", name: "server", assetId: null });
  });

  it("exports and imports archives, guides (Markdown) and decks (Anki CSV)", async () => {
    const id = await newArchive(alice, { title: "Export me", tags: ["a"] });
    await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "G", markdown: "# Heading\nbody" });
    await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "deck", title: "D", cards: [{ front: 'Say "hi", now', back: "line1\nline2", tags: ["x", "y"] }] });
    const exp = await call(alice, "GET", `/v1/archives/${id}/export`);
    expect(exp.headers["content-disposition"]).toContain("export-me.ultimyr.json");
    const doc = json(exp);
    expect(doc.items).toHaveLength(2);
    const imported = json(await call(bob, "POST", "/v1/import", { format: "archive-json", content: JSON.stringify(doc) }));
    const copy = json(await call(bob, "GET", `/v1/archives/${imported.archiveId}`));
    expect(copy.title).toBe("Export me");
    expect(copy.ownerId).toBe(bob);
    expect(copy.items.map((i: any) => i.kind)).toEqual(["guide", "deck"]);
    const deck = copy.items.find((i: any) => i.kind === "deck");
    const csv = await call(bob, "GET", `/v1/items/${deck.id}/export?format=anki-csv`);
    expect(csv.body).toBe('"Say ""hi"", now","line1\nline2",x y\n');
    const md = await call(bob, "GET", `/v1/items/${copy.items.find((i: any) => i.kind === "guide").id}/export?format=markdown`);
    expect(md.body).toBe("# Heading\nbody");

    const imp = json(await call(alice, "POST", "/v1/import", { format: "anki-csv", archiveId: id, title: "From Anki", content: csv.body }));
    expect(imp.cards).toBe(1);
    const back = json(await call(alice, "GET", `/v1/items/${imp.itemId}/cards`));
    expect(back[0]).toMatchObject({ front: 'Say "hi", now', back: "line1\nline2", tags: ["x", "y"] });
    const mdImp = json(await call(alice, "POST", "/v1/import", { format: "markdown", archiveId: id, content: "# Imported title\n\n## Part\ntext" }));
    expect(json(await call(alice, "GET", `/v1/items/${mdImp.itemId}`)).title).toBe("Imported title");
    // Importing into someone else's archive is refused.
    expect((await call(bob, "POST", "/v1/import", { format: "markdown", archiveId: id, content: "# x" })).statusCode).toBe(404);
    expect((await call(alice, "POST", "/v1/import", { format: "archive-json", content: "{not json" })).statusCode).toBe(400);
    expect((await call(alice, "POST", "/v1/import", { format: "anki-csv", archiveId: id, title: "e", content: "\n\n" })).statusCode).toBe(400);
  });

  it("soft-deleted items can be restored, and purging removes them for good", async () => {
    const id = await newArchive();
    const g = json(await call(alice, "POST", `/v1/archives/${id}/items`, { kind: "guide", title: "Oops", markdown: "x" }));
    expect((await call(alice, "DELETE", `/v1/items/${g.id}`)).statusCode).toBe(204);
    expect((await call(alice, "GET", `/v1/items/${g.id}`)).statusCode).toBe(404);
    expect(json(await call(alice, "GET", "/v1/trash")).items.map((x: any) => x.id)).toContain(g.id);
    expect((await call(alice, "POST", `/v1/items/${g.id}/restore`)).statusCode).toBe(200);
    expect((await call(alice, "GET", `/v1/items/${g.id}`)).statusCode).toBe(200);
    await call(alice, "DELETE", `/v1/items/${g.id}`);
    await h.pool.query("UPDATE content.sub_items SET deleted_at = now() - interval '31 days' WHERE id = $1", [g.id]);
    const { purgeDeleted } = await import("../src/app.js");
    expect(await purgeDeleted(h.pool)).toBeGreaterThanOrEqual(1);
    expect((await h.pool.query("SELECT 1 FROM content.sub_items WHERE id = $1", [g.id])).rowCount).toBe(0);
    expect((await h.pool.query("SELECT 1 FROM content.item_versions WHERE sub_item_id = $1", [g.id])).rowCount).toBe(0);
  });

  it("lists with pagination and filters by scope and text", async () => {
    const owner = uuid();
    for (let i = 0; i < 3; i++) await newArchive(owner, { title: `Series ${i}` });
    const page1 = json(await call(owner, "GET", "/v1/archives?limit=2"));
    const page2 = json(await call(owner, "GET", "/v1/archives?limit=2&offset=2"));
    expect(page1.archives).toHaveLength(2);
    expect(page2.archives).toHaveLength(1);
    expect(json(await call(owner, "GET", "/v1/archives?q=Series 1")).archives).toHaveLength(1);
    expect(json(await call(owner, "GET", "/v1/archives?scope=shared")).archives).toHaveLength(0);
  });
});

describe.skipIf(!testDbUrl)("data the database cannot store", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it("answers 400, not 500, for a NUL character in a title or a search", async () => {
    const u = uuid();
    const headers = await h.issuer.bearer({ userId: u });
    const make = await h.app.inject({ method: "POST", url: "/v1/archives", headers, payload: { title: "a\u0000b" } });
    expect(make.statusCode).toBe(400);
    const find = await h.app.inject({ method: "GET", url: "/v1/search?q=%00", headers });
    expect(find.statusCode).toBe(400);
  });
});
