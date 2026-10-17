import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

const opts = ["a", "b", "c"].map((id) => ({ id, text: id }));
const mcq = (stem: string) => ({ type: "mcq", stem, domain: "D", payload: { options: opts }, key: { correct: "a" } });

describe.skipIf(!testDbUrl)("question reports and item analysis", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  const author = uuid();
  const l1 = uuid();
  const l2 = uuid();
  const archive = uuid();
  const item = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);
  const take = async (u: string, choice: string) => {
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const at = json(await call(u, "POST", `/v1/quizzes/${item}/attempts`, { restart: true }));
    const q = at.questions[0];
    await call(u, "PUT", `/v1/attempts/${at.id}/items/${q.id}`, { response: { choice }, timeMs: 8000 });
    await call(u, "POST", `/v1/attempts/${at.id}/submit`);
    return q.id as string;
  };
  let qid: string;

  beforeAll(async () => {
    for (const u of [author, l1, l2]) h.access.set(`${u}:${item}`, { kind: "quiz", archiveId: archive, status: "published", canAttempt: true, canWrite: u === author });
    await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("Only one"));
    qid = await take(l1, "a");
    await take(l2, "b");
    await take(l1, "b");
  });

  it("shows editors how a question performs, without naming anyone", async () => {
    const r = json(await call(author, "GET", `/v1/quizzes/${item}/item-analysis`));
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0]).toMatchObject({ questionId: qid, answers: 3, people: 2, avgMs: 8000, picks: { a: 1, b: 2 } });
    expect(r.questions[0].correctBp).toBe(3333);
    expect((await call(l1, "GET", `/v1/quizzes/${item}/item-analysis`)).statusCode).toBe(404);
  });

  it("takes a report from someone who was served the question, and lets editors resolve it", async () => {
    expect((await call(uuid(), "POST", `/v1/questions/${qid}/report`, { kind: "typo" })).statusCode).toBe(404);
    expect((await call(l1, "POST", `/v1/questions/${qid}/report`, { kind: "bogus" })).statusCode).toBe(400);
    const first = await call(l1, "POST", `/v1/questions/${qid}/report`, { kind: "unclear", message: "Which port?" });
    expect(first.statusCode).toBe(201);
    // Reporting again replaces the open report rather than piling up.
    await call(l1, "POST", `/v1/questions/${qid}/report`, { kind: "wrong_answer", message: "B is right" });
    await call(l2, "POST", `/v1/questions/${qid}/report`, { kind: "typo" });
    const list = json(await call(author, "GET", `/v1/quizzes/${item}/reports`)).reports;
    expect(list).toHaveLength(2);
    expect(list.map((x: any) => x.kind).sort()).toEqual(["typo", "wrong_answer"]);
    expect(JSON.stringify(list)).not.toContain(l1);
    expect(json(await call(author, "GET", `/v1/quizzes/${item}/item-analysis`)).openReports).toEqual({ [qid]: 2 });
    expect((await call(l1, "GET", `/v1/quizzes/${item}/reports`)).statusCode).toBe(404);
    const id = list[0].id;
    expect((await call(l1, "POST", `/v1/reports/${id}/resolve`, {})).statusCode).toBe(404);
    expect((await call(author, "POST", `/v1/reports/${id}/resolve`, { resolution: "Fixed" })).statusCode).toBe(200);
    expect(json(await call(author, "GET", `/v1/quizzes/${item}/reports`)).reports).toHaveLength(1);
    expect(json(await call(author, "GET", `/v1/quizzes/${item}/reports?status=resolved`)).reports[0]).toMatchObject({ resolution: "Fixed" });
  });
});
