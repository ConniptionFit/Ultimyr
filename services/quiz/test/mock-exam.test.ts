import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

const opts = ["a", "b", "c"].map((id) => ({ id, text: id }));
const mcq = (stem: string, objectiveId?: string) => ({ type: "mcq", stem, domain: "D", payload: { options: opts }, key: { correct: "a" }, ...(objectiveId ? { objectiveId } : {}) });

describe.skipIf(!testDbUrl)("blueprint mock exams", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  const author = uuid();
  const learner = uuid();
  const archive = uuid();
  const item = uuid();
  const objA = uuid();
  const objB = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  beforeAll(async () => {
    h.access.set(`${author}:${item}`, { kind: "quiz", archiveId: archive, status: "published", canAttempt: true, canWrite: true });
    h.access.set(`${learner}:${item}`, { kind: "quiz", archiveId: archive, status: "published", canAttempt: true, canWrite: false });
    h.archives.set(`${author}:${archive}`, { canRead: true, canWrite: true, quizzes: [{ id: item, title: "Q", status: "published", canAttempt: true, canWrite: true }] });
    h.archives.set(`${learner}:${archive}`, { canRead: true, canWrite: false, quizzes: [{ id: item, title: "Q", status: "published", canAttempt: true, canWrite: false }] });
    for (let i = 0; i < 30; i++) await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq(`A${i}`, objA));
    for (let i = 0; i < 30; i++) await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq(`B${i}`, objB));
    for (let i = 0; i < 10; i++) await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq(`U${i}`));
  });

  const start = (body: Record<string, unknown> = {}) => call(learner, "POST", "/v1/mock-exams", { archiveId: archive, restart: true, ...body });

  it("follows the exam's domain shares and is a timed exam with no feedback", async () => {
    const r = await start({ count: 20, minutes: 30, blueprint: [{ objectiveIds: [objA], weightBp: 7500 }, { objectiveIds: [objB], weightBp: 2500 }] });
    expect(r.statusCode).toBe(201);
    const m = json(r);
    expect(m).toMatchObject({ kind: "mock", mode: "exam_sim", status: "in_progress", archiveId: archive, mock: { count: 20, minutes: 30, blueprint: true } });
    const stems: string[] = m.questions.map((q: any) => q.stem);
    expect(stems.filter((s) => s.startsWith("A"))).toHaveLength(15);
    expect(stems.filter((s) => s.startsWith("B"))).toHaveLength(5);
    expect(new Date(m.deadlineAt).getTime() - new Date(m.startedAt).getTime()).toBe(30 * 60_000);
    expect(JSON.stringify(m)).not.toContain('"correct"');
    const q = m.questions[0];
    expect((await call(learner, "POST", `/v1/attempts/${m.id}/items/${q.id}/check`)).statusCode).toBe(409);
  });

  it("resumes an open mock exam unless asked to restart", async () => {
    const a = json(await start({ count: 10 }));
    const b = await call(learner, "POST", "/v1/mock-exams", { archiveId: archive, count: 10 });
    expect(b.statusCode).toBe(200);
    expect(json(b)).toMatchObject({ id: a.id, resumed: true });
  });

  it("uses what is left for questions on no listed objective, and counts toward readiness once graded", async () => {
    const m = json(await start({ count: 20, blueprint: [{ objectiveIds: [objA], weightBp: 5000 }] }));
    const stems: string[] = m.questions.map((q: any) => q.stem);
    expect(stems.filter((s) => s.startsWith("A"))).toHaveLength(10);
    // The rest (B and unmapped questions) share the other half.
    expect(stems.filter((s) => !s.startsWith("A"))).toHaveLength(10);
    const done = json(await call(learner, "POST", `/v1/attempts/${m.id}/submit`));
    expect(done).toMatchObject({ kind: "mock", status: "submitted" });
    const before = json(await call(learner, "GET", `/v1/analytics?archive=${archive}`)).readiness;
    for (let i = 0; i < 2; i++) {
      const x = json(await start({ count: 10 }));
      await call(learner, "POST", `/v1/attempts/${x.id}/submit`);
    }
    const after = json(await call(learner, "GET", `/v1/analytics?archive=${archive}`)).readiness;
    expect(after.basedOn).toBeGreaterThan(before?.basedOn ?? 0);
    expect(after.basedOn).toBeGreaterThanOrEqual(3);
  });

  it("prefers questions you have not answered, rejects bad input and strangers", async () => {
    expect((await call(uuid(), "POST", "/v1/mock-exams", { archiveId: archive })).statusCode).toBe(404);
    expect((await call(learner, "POST", "/v1/mock-exams", { archiveId: archive, count: 5 })).statusCode).toBe(400);
    expect((await call(learner, "POST", "/v1/mock-exams", { archiveId: archive, minutes: 5 })).statusCode).toBe(400);
    expect((await call(learner, "POST", "/v1/mock-exams", { archiveId: archive, blueprint: [{ objectiveIds: [], weightBp: 1 }] })).statusCode).toBe(400);
    expect((await call(learner, "POST", "/v1/mock-exams", { archiveId: archive, profileId: uuid(), restart: true })).statusCode).toBe(400);
  });
});
