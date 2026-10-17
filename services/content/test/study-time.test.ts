import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("study time log", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  const alice = uuid();
  const bob = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  it("logs minutes against a course and totals them per day and course", async () => {
    h.clock.now = new Date("2026-10-10T15:00:00Z");
    const a1 = json(await call(alice, "POST", "/v1/archives", { title: "Net+" })).id;
    const a2 = json(await call(alice, "POST", "/v1/archives", { title: "Sec+" })).id;
    expect((await call(alice, "POST", "/v1/study/time", { archiveId: a1, minutes: 45, source: "timer" })).statusCode).toBe(201);
    await call(alice, "POST", "/v1/study/time", { archiveId: a1, minutes: 30, day: "2026-10-08", note: "labs" });
    await call(alice, "POST", "/v1/study/time", { archiveId: a2, minutes: 20 });
    const all = json(await call(alice, "GET", "/v1/study/time?days=7&tz=UTC"));
    expect(all.totalMinutes).toBe(95);
    expect(all.byDay).toEqual([{ date: "2026-10-08", minutes: 30 }, { date: "2026-10-10", minutes: 65 }]);
    expect(all.byCourse).toEqual([{ archiveId: a1, title: "Net+", minutes: 75 }, { archiveId: a2, title: "Sec+", minutes: 20 }]);
    expect(all.entries[0]).toMatchObject({ day: "2026-10-10" });
    expect(json(await call(alice, "GET", `/v1/study/time?archive=${a2}`)).totalMinutes).toBe(20);
    // An older entry falls outside a shorter window.
    expect(json(await call(alice, "GET", "/v1/study/time?days=1&tz=UTC")).totalMinutes).toBe(65);
  });

  it("refuses the future, strangers' courses and nonsense", async () => {
    h.clock.now = new Date("2026-10-10T15:00:00Z");
    const a = json(await call(alice, "POST", "/v1/archives", { title: "X" })).id;
    expect((await call(alice, "POST", "/v1/study/time", { archiveId: a, minutes: 10, day: "2026-10-12" })).statusCode).toBe(400);
    expect((await call(alice, "POST", "/v1/study/time", { archiveId: a, minutes: 0 })).statusCode).toBe(400);
    expect((await call(alice, "POST", "/v1/study/time", { archiveId: a, minutes: 2000 })).statusCode).toBe(400);
    expect((await call(bob, "POST", "/v1/study/time", { archiveId: a, minutes: 10 })).statusCode).toBe(404);
  });

  it("keeps each person's log private, deletes your own and exports CSV safely", async () => {
    h.clock.now = new Date("2026-10-10T15:00:00Z");
    const a = json(await call(alice, "POST", "/v1/archives", { title: "Priv" })).id;
    const id = json(await call(alice, "POST", "/v1/study/time", { archiveId: a, minutes: 15, note: "=SUM(1)" })).id;
    expect(json(await call(bob, "GET", "/v1/study/time")).totalMinutes).toBe(0);
    expect((await call(bob, "DELETE", `/v1/study/time/${id}`)).statusCode).toBe(404);
    const csv = (await call(alice, "GET", "/v1/study/time/export")).body;
    expect(csv.split("\n")[0]).toBe("date,course,minutes,note,source");
    expect(csv).toContain("'=SUM(1)");
    expect((await call(alice, "DELETE", `/v1/study/time/${id}`)).statusCode).toBe(204);
    expect((await call(alice, "DELETE", `/v1/study/time/${id}`)).statusCode).toBe(404);
  });
});
