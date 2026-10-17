import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("suspend, bury and leeches", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  const alice = uuid();
  const bob = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function deck() {
    const archive = json(await call(alice, "POST", "/v1/archives", { title: "Flags" })).id;
    const d = json(await call(alice, "POST", `/v1/archives/${archive}/items`, { kind: "deck", title: "D", cards: [{ front: "Q1", back: "A1" }, { front: "Q2", back: "A2" }] })).id;
    const cards = json(await call(alice, "GET", `/v1/items/${d}`)).cards as { id: string; front: string }[];
    return { archive, cards };
  }
  const fronts = async (u: string, archive: string) => json(await call(u, "GET", `/v1/study/queue?archive=${archive}`)).cards.map((c: any) => c.front);

  it("hides a suspended card for you only, and brings it back", async () => {
    h.clock.now = new Date("2026-10-04T12:00:00Z");
    const { archive, cards } = await deck();
    expect(await fronts(alice, archive)).toEqual(["Q1", "Q2"]);
    const r = await call(alice, "POST", `/v1/study/cards/${cards[0]!.id}/suspend`, { suspended: true });
    expect(r.statusCode).toBe(200);
    expect(await fronts(alice, archive)).toEqual(["Q2"]);
    const list = json(await call(alice, "GET", "/v1/study/suspended")).cards;
    expect(list.map((c: any) => c.front)).toContain("Q1");
    await call(alice, "POST", `/v1/study/cards/${cards[0]!.id}/suspend`, { suspended: false });
    expect(await fronts(alice, archive)).toEqual(["Q1", "Q2"]);
  });

  it("buries a card until the start of tomorrow", async () => {
    h.clock.now = new Date("2026-10-04T12:00:00Z");
    const { archive, cards } = await deck();
    const r = json(await call(alice, "POST", `/v1/study/cards/${cards[1]!.id}/bury`, { tz: "UTC" }));
    expect(r.buriedUntil).toBe("2026-10-05T00:00:00.000Z");
    expect(await fronts(alice, archive)).toEqual(["Q1"]);
    h.clock.now = new Date("2026-10-05T00:00:01Z");
    expect(await fronts(alice, archive)).toEqual(["Q1", "Q2"]);
  });

  it("refuses cards you cannot read", async () => {
    const { cards } = await deck();
    expect((await call(bob, "POST", `/v1/study/cards/${cards[0]!.id}/suspend`, { suspended: true })).statusCode).toBe(404);
  });

  it("flags a leech and suspends it only when you ask", async () => {
    h.clock.now = new Date("2026-10-04T12:00:00Z");
    const { archive, cards } = await deck();
    const id = cards[0]!.id;
    const lapse = async () => {
      h.clock.now = new Date(h.clock.now.getTime() + 30 * 86_400_000);
      await call(alice, "POST", "/v1/study/review", { cardId: id, rating: 3 });
      h.clock.now = new Date(h.clock.now.getTime() + 60 * 86_400_000);
      return json(await call(alice, "POST", "/v1/study/review", { cardId: id, rating: 1 }));
    };
    await call(alice, "POST", "/v1/study/review", { cardId: id, rating: 3 });
    let last: any;
    for (let i = 0; i < 8; i++) last = await lapse();
    expect(last).toMatchObject({ lapses: 8, leech: true, suspended: false });
    await call(alice, "PUT", "/v1/study/settings", { leechSuspend: true });
    last = await lapse();
    expect(last).toMatchObject({ leech: true, suspended: true });
    expect(await fronts(alice, archive)).toEqual(["Q2"]);
  });
});
