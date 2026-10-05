import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("spaced repetition", () => {
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
  const at = (iso: string) => (h.clock.now = new Date(iso));

  async function deckWith(n: number, over: Record<string, unknown> = {}) {
    const archive = json(await call(alice, "POST", "/v1/archives", { title: `Archive ${uuid().slice(0, 4)}` })).id;
    const deck = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "deck", title: "Ports", cards: Array.from({ length: n }, (_, i) => ({ front: `Q${i + 1}`, back: `A${i + 1}` })), ...over }));
    return { archive, deck: deck.id as string, cards: json(await call(alice, "GET", `/v1/items/${deck.id}`)).cards as { id: string; front: string }[] };
  }

  it("needs a token and the right scope", async () => {
    expect((await h.app.inject({ url: "/v1/study/queue" })).statusCode).toBe(401);
    const { cards } = await deckWith(1);
    const r = await call(alice, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 3 }, { scopes: ["content:read"] });
    expect(r.statusCode).toBe(403);
  });

  it("offers new cards, schedules them after a review, and brings them back when due", async () => {
    at("2026-10-04T12:00:00Z");
    const { archive, cards } = await deckWith(3);
    const q = json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`));
    expect(q.counts).toMatchObject({ due: 0, new: 3, newAllowanceLeft: 20 });
    expect(q.cards.map((c: any) => c.front)).toEqual(["Q1", "Q2", "Q3"]);
    expect(q.cards[0].next["3"].days).toBe(3);
    expect(q.cards[0].next["1"].due).toBe("2026-10-04T12:01:00.000Z");

    const rev = json(await call(alice, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 3, durationMs: 4200 }));
    expect(rev).toMatchObject({ state: 2, scheduledDays: 3, reps: 1, lapses: 0, due: "2026-10-07T12:00:00.000Z" });
    await call(alice, "POST", "/v1/study/review", { cardId: cards[1]!.id, rating: 1 });

    const after = json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`));
    expect(after.cards.map((c: any) => c.front)).toEqual(["Q3"]);
    expect(after.counts.newAllowanceLeft).toBe(18);

    at("2026-10-04T12:02:00Z"); // the "again" card is due after a minute
    const soon = json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`));
    expect(soon.cards.map((c: any) => c.front)).toEqual(["Q2", "Q3"]);
    expect(soon.cards[0].state).toBe(1);

    at("2026-10-07T12:00:00Z");
    const later = json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`));
    expect(later.cards.map((c: any) => c.front)).toEqual(["Q2", "Q1", "Q3"]);
    const again = json(await call(alice, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 3 }));
    expect(again.scheduledDays).toBeGreaterThan(3);
    expect(again.reps).toBe(2);
  });

  it("limits new cards per day and lets people change the limit and retention", async () => {
    at("2026-11-01T09:00:00Z");
    const { archive, cards } = await deckWith(5);
    expect(json(await call(alice, "PUT", "/v1/study/settings", { newPerDay: 2 }))).toEqual({ desiredRetention: 0.9, newPerDay: 2 });
    expect(json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`)).cards).toHaveLength(2);
    await call(alice, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 3 });
    await call(alice, "POST", "/v1/study/review", { cardId: cards[1]!.id, rating: 3 });
    const done = json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`));
    expect(done.cards).toHaveLength(0);
    expect(done.counts.newAllowanceLeft).toBe(0);
    at("2026-11-02T09:00:00Z"); // a new day
    expect(json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`)).cards.length).toBe(2);
    expect(json(await call(alice, "PUT", "/v1/study/settings", { desiredRetention: 0.8 })).desiredRetention).toBe(0.8);
    expect(json(await call(alice, "GET", "/v1/study/settings"))).toEqual({ desiredRetention: 0.8, newPerDay: 2 });
    expect((await call(alice, "PUT", "/v1/study/settings", { desiredRetention: 0.2 })).statusCode).toBe(400);
    expect((await call(alice, "PUT", "/v1/study/settings", { newPerDay: 9999 })).statusCode).toBe(400);
    await call(alice, "PUT", "/v1/study/settings", { desiredRetention: 0.9, newPerDay: 20 });
  });

  it("only offers and accepts cards the person can read, and keeps schedules private", async () => {
    at("2026-12-01T09:00:00Z");
    const { archive, deck, cards } = await deckWith(2);
    expect((await call(bob, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 3 })).statusCode).toBe(404);
    expect(json(await call(bob, "GET", `/v1/study/queue?archive=${archive}`)).cards).toEqual([]);
    await call(alice, "POST", `/v1/archives/${archive}/grants`, { subjectType: "user", subjectId: bob, relation: "viewer" });
    expect(json(await call(bob, "GET", `/v1/study/queue?archive=${archive}`)).cards).toHaveLength(2);
    expect((await call(bob, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 4 })).statusCode).toBe(200);
    // Alice's own queue is unaffected by Bob's review
    expect(json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`)).cards).toHaveLength(2);
    expect((await call(alice, "POST", "/v1/study/review", { cardId: uuid(), rating: 3 })).statusCode).toBe(404);
    expect((await call(alice, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 7 })).statusCode).toBe(400);
    // draft decks are for editors only
    await call(alice, "PATCH", `/v1/items/${deck}`, { status: "draft" });
    expect(json(await call(bob, "GET", `/v1/study/queue?archive=${archive}`)).cards).toEqual([]);
    expect((await call(bob, "POST", "/v1/study/review", { cardId: cards[1]!.id, rating: 3 })).statusCode).toBe(404);
    expect(json(await call(alice, "GET", `/v1/study/queue?archive=${archive}&deck=${deck}`)).cards).toHaveLength(2);
  });

  it("reports counts, retention and a seven day forecast", async () => {
    at("2027-01-10T08:00:00Z");
    const { archive, cards } = await deckWith(3);
    for (const c of cards) await call(alice, "POST", "/v1/study/review", { cardId: c.id, rating: 3 });
    const fresh = json(await call(alice, "GET", `/v1/study/stats?archive=${archive}`));
    expect(fresh).toMatchObject({ review: 3, learning: 0, dueNow: 0, reviewedToday: 3, retentionBp: null, forecast: [0, 0, 0, 3, 0, 0, 0] });
    at("2027-01-13T08:00:00Z");
    await call(alice, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 3 });
    await call(alice, "POST", "/v1/study/review", { cardId: cards[1]!.id, rating: 1 });
    const s = json(await call(alice, "GET", `/v1/study/stats?archive=${archive}`));
    expect(s).toMatchObject({ recalls30d: 2, retentionBp: 5000, learning: 1, review: 2, reviewedToday: 2 });
    expect(s.dueNow).toBeGreaterThanOrEqual(1);
    expect(json(await call(bob, "GET", `/v1/study/stats?archive=${archive}`))).toMatchObject({ review: 0, reviewedToday: 0 });
  });

  it("deleting a card removes its schedule", async () => {
    at("2027-02-01T08:00:00Z");
    const { archive, deck, cards } = await deckWith(2);
    await call(alice, "POST", "/v1/study/review", { cardId: cards[0]!.id, rating: 3 });
    await call(alice, "POST", `/v1/items/${deck}/cards/delete`, { ids: [cards[0]!.id] });
    expect(json(await call(alice, "GET", `/v1/study/stats?archive=${archive}`))).toMatchObject({ review: 0 });
  });
});

describe.skipIf(!testDbUrl)("undo a review", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  const alice = uuid();
  const bob = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  it("restores the earlier schedule, or makes a first review new again, and refuses stale or foreign undos", async () => {
    h.clock.now = new Date("2026-10-04T12:00:00Z");
    const archive = json(await call(alice, "POST", "/v1/archives", { title: "Undo" })).id;
    const deck = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "deck", title: "D", cards: [{ front: "Q", back: "A" }] })).id;
    const card = json(await call(alice, "GET", `/v1/items/${deck}`)).cards[0].id as string;

    const first = json(await call(alice, "POST", "/v1/study/review", { cardId: card, rating: 3 }));
    expect(first.reviewId).toBeTruthy();
    expect((await call(bob, "POST", "/v1/study/review/undo", { reviewId: first.reviewId })).statusCode).toBe(404);
    expect((await call(alice, "POST", "/v1/study/review/undo", { reviewId: first.reviewId })).statusCode).toBe(200);
    const q = json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`));
    expect(q.counts).toMatchObject({ due: 0, new: 1 });
    expect((await call(alice, "POST", "/v1/study/review/undo", { reviewId: first.reviewId })).statusCode).toBe(404);

    const one = json(await call(alice, "POST", "/v1/study/review", { cardId: card, rating: 3 }));
    h.clock.now = new Date("2026-10-07T12:00:00Z");
    const two = json(await call(alice, "POST", "/v1/study/review", { cardId: card, rating: 1 }));
    expect(two.lapses).toBe(1);
    expect((await call(alice, "POST", "/v1/study/review/undo", { reviewId: one.reviewId })).statusCode).toBe(409);
    expect((await call(alice, "POST", "/v1/study/review/undo", { reviewId: two.reviewId })).statusCode).toBe(200);
    const stats = json(await call(alice, "GET", `/v1/study/queue?archive=${archive}`));
    expect(stats.cards[0].state).toBe(2);
    expect(stats.cards[0].due).toBe(one.due);
  });
});

describe.skipIf(!testDbUrl)("review history export", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  const alice = uuid();
  const bob = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  it("lists only your own reviews as CSV, with commas in cards quoted", async () => {
    h.clock.now = new Date("2026-10-04T12:00:00Z");
    const archive = json(await call(alice, "POST", "/v1/archives", { title: "Export" })).id;
    const deck = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "deck", title: "D", cards: [{ front: "Ports, common", back: "A" }, { front: "=1+1", back: "B" }] })).id;
    const cards = json(await call(alice, "GET", `/v1/items/${deck}`)).cards as { id: string; front: string }[];
    const card = cards.find((c) => c.front.startsWith("Ports"))!.id;
    await call(alice, "POST", "/v1/study/review", { cardId: card, rating: 3, durationMs: 4200 });
    await call(alice, "POST", "/v1/study/review", { cardId: cards.find((c) => c.front === "=1+1")!.id, rating: 3 });
    const mine = await call(alice, "GET", "/v1/study/export");
    expect(mine.statusCode).toBe(200);
    expect(mine.headers["content-type"]).toContain("text/csv");
    const lines = mine.body.trim().split("\n");
    expect(lines[0]).toBe("reviewed_at,course,deck,card,rating,was_new,scheduled_days,seconds");
    expect(lines).toHaveLength(3);
    expect(mine.body).toContain("'=1+1");
    expect(mine.body).toContain('"Ports, common"');
    expect(mine.body).toContain(",3,yes,");
    expect((await call(bob, "GET", "/v1/study/export")).body.trim().split("\n")).toHaveLength(1);
  });
});
