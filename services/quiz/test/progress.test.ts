import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

const opts = ["a", "b", "c"].map((id) => ({ id, text: id }));
const mcq = (stem: string, domain: string) => ({ type: "mcq", stem, domain, payload: { options: opts }, key: { correct: "a" } });

describe.skipIf(!testDbUrl)("progress: analytics, goals and the live clock", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const author = uuid();
  const learner = uuid();
  const archive = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown, scopes?: string[]) =>
    h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u, ...(scopes ? { scopes } : {}) }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);
  const at = (iso: string) => (h.clock.now = new Date(iso));

  function quiz() {
    const id = uuid();
    h.access.set(`${author}:${id}`, { kind: "quiz", archiveId: archive, status: "published", canAttempt: true, canWrite: true });
    h.access.set(`${learner}:${id}`, { kind: "quiz", archiveId: archive, status: "published", canAttempt: true, canWrite: false });
    return id;
  }
  /** Take an attempt answering the first `right` questions correctly. */
  async function attempt(item: string, right: number) {
    const at_ = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, { restart: true }));
    const order = [...at_.questions].sort((x: any, y: any) => x.stem.localeCompare(y.stem));
    for (const [i, q] of order.entries()) await call(learner, "PUT", `/v1/attempts/${at_.id}/items/${q.id}`, { response: { choice: i < right ? "a" : "b" }, timeMs: 6000 });
    return json(await call(learner, "POST", `/v1/attempts/${at_.id}/submit`));
  }

  it("summarises attempts by day and domain, finds weak spots, and tracks readiness", async () => {
    const item = quiz();
    const qs = [["A1", "Hardware"], ["A2", "Hardware"], ["A3", "Hardware"], ["B1", "Networking"], ["B2", "Networking"], ["B3", "Networking"]];
    for (const [stem, domain] of qs) await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq(stem!, domain!));
    await call(author, "PUT", `/v1/quizzes/${item}/config`, { shuffleQuestions: false });

    expect(json(await call(learner, "GET", `/v1/analytics?archive=${archive}`))).toMatchObject({ summary: { attempts: 0, accuracyBp: 0, streakDays: 0 }, daily: [], readiness: { bp: null, basedOn: 0 } });

    at("2026-10-01T10:00:00Z");
    await attempt(item, 3); // all Hardware right, no Networking: 50%
    at("2026-10-02T10:00:00Z");
    await attempt(item, 3);
    at("2026-10-03T10:00:00Z");
    const last = await attempt(item, 6); // 100%
    expect(last.result.rawBp).toBe(10_000);
    at("2026-10-03T18:00:00Z");

    const an = json(await call(learner, "GET", `/v1/analytics?archive=${archive}&days=30`));
    expect(an.summary).toMatchObject({ attempts: 3, streakDays: 3 });
    expect(an.summary.accuracyBp).toBe(6667); // 12 of 18 marks
    expect(an.summary.minutes).toBe(3); // 6 questions x 6 s = 36 s a day, shown as whole minutes
    expect(an.daily.map((d: any) => [d.date, d.attempts, d.accuracyBp])).toEqual([["2026-10-01", 1, 5000], ["2026-10-02", 1, 5000], ["2026-10-03", 1, 10000]]);
    expect(an.domains).toEqual([
      { domain: "Hardware", accuracyBp: 10_000, questions: 9, correct: 9 },
      { domain: "Networking", accuracyBp: 3333, questions: 9, correct: 3 },
    ]);
    expect(an.weak[0].domain).toBe("Networking");
    // weights 1,2,3 on 50%, 50%, 100% => (5000 + 10000 + 30000) / 6 = 7500
    expect(an.readiness).toMatchObject({ bp: 7500, basedOn: 3 });
    expect(an.goal).toBeNull();

    // narrower range, and another archive sees nothing
    expect(json(await call(learner, "GET", `/v1/analytics?archive=${archive}&days=1`)).summary.attempts).toBe(1);
    expect(json(await call(learner, "GET", `/v1/analytics?archive=${uuid()}`)).summary.attempts).toBe(0);
    expect(json(await call(author, "GET", `/v1/analytics?archive=${archive}`)).summary.attempts).toBe(0);
    expect(json(await call(learner, "GET", "/v1/analytics")).summary.attempts).toBe(3);
    expect((await call(learner, "GET", "/v1/analytics?days=0")).statusCode).toBe(400);
  });

  it("keeps a streak through today or yesterday, then loses it", async () => {
    at("2026-10-04T09:00:00Z"); // yesterday was active, today not yet
    expect(json(await call(learner, "GET", "/v1/analytics")).summary.streakDays).toBe(3);
    at("2026-10-06T09:00:00Z"); // a full day missed
    expect(json(await call(learner, "GET", "/v1/analytics")).summary.streakDays).toBe(0);
  });

  it("counts days and the streak on the caller's own calendar when given a time zone", async () => {
    // Attempts were at 10:00Z on Oct 1 to 3, which is 00:00 on Oct 2 to 4 in Kiritimati (UTC+14).
    at("2026-10-05T09:00:00Z");
    expect(json(await call(learner, "GET", "/v1/analytics")).summary.streakDays).toBe(0);
    const k = json(await call(learner, "GET", "/v1/analytics?tz=Pacific/Kiritimati&days=30"));
    expect(k.summary.streakDays).toBe(3);
    expect(k.daily.map((d: any) => d.date)).toEqual(["2026-10-02", "2026-10-03", "2026-10-04"]);
    // A zone Postgres does not know is treated as UTC.
    expect(json(await call(learner, "GET", "/v1/analytics?tz=Nowhere/Land")).summary.streakDays).toBe(0);
  });

  it("stores one goal per archive and reports progress against it", async () => {
    at("2026-10-04T09:00:00Z");
    expect(json(await call(learner, "GET", `/v1/goals/${archive}`))).toEqual({ goal: null });
    const put = await call(learner, "PUT", `/v1/goals/${archive}`, { targetBp: 8000, targetDate: "2026-10-14" });
    expect(json(put)).toEqual({ archiveId: archive, targetBp: 8000, targetDate: "2026-10-14" });
    const an = json(await call(learner, "GET", `/v1/analytics?archive=${archive}`));
    expect(an.goal).toMatchObject({ targetBp: 8000, daysLeft: 11, onTrack: false, gapBp: 500 });
    await call(learner, "PUT", `/v1/goals/${archive}`, { targetBp: 7000 });
    expect(json(await call(learner, "GET", `/v1/analytics?archive=${archive}`)).goal).toMatchObject({ targetBp: 7000, targetDate: null, daysLeft: null, onTrack: true, gapBp: 0 });
    expect(json(await call(learner, "GET", "/v1/goals")).goals).toHaveLength(1);
    expect(json(await call(author, "GET", "/v1/goals")).goals).toHaveLength(0);
    expect((await call(learner, "PUT", `/v1/goals/${archive}`, { targetBp: 0 })).statusCode).toBe(400);
    expect((await call(learner, "PUT", `/v1/goals/${archive}`, { targetBp: 5000, targetDate: "2020-01-01" })).statusCode).toBe(400);
    expect((await call(learner, "PUT", `/v1/goals/${archive}`, { targetBp: 5000 }, ["quiz:read"])).statusCode).toBe(403);
    expect((await call(learner, "DELETE", `/v1/goals/${archive}`)).statusCode).toBe(204);
    expect(json(await call(learner, "GET", `/v1/goals/${archive}`))).toEqual({ goal: null });
  });

  it("streams the server clock for an open attempt and says when it closes", async () => {
    const item = quiz();
    await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("S1", "X"));
    await call(author, "PUT", `/v1/quizzes/${item}/config`, { mode: "timed", timeLimitSeconds: 60, graceSeconds: 0 });
    at("2026-10-10T10:00:00Z");
    const started = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {}));
    process.env.QUIZ_SSE_INTERVAL_MS = "50";
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = h.app.server.address() as { port: number };
    const bearer = (await h.issuer.bearer({ userId: learner })).authorization;
    const res = await fetch(`http://127.0.0.1:${port}/v1/attempts/${started.id}/events`, { headers: { authorization: bearer } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const read = async (until: string) => {
      while (!text.includes(until)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value);
      }
    };
    await read("event: tick");
    expect(text).toContain('"remainingMs":60000');
    at("2026-10-10T10:01:30Z"); // past the deadline
    await read("event: closed");
    expect(text).toContain('"status":"expired"');
    const done = await reader.read();
    expect(done.done).toBe(true);
    delete process.env.QUIZ_SSE_INTERVAL_MS;

    expect((await fetch(`http://127.0.0.1:${port}/v1/attempts/${started.id}/events`)).status).toBe(401);
    expect((await call(uuid(), "GET", `/v1/attempts/${started.id}/events`)).statusCode).toBe(404);
  });
});
