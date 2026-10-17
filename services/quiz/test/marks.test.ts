import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

const opts = ["a", "b", "c"].map((id) => ({ id, text: id }));
const mcq = (stem: string, domain: string) => ({ type: "mcq", stem, domain, payload: { options: opts }, key: { correct: "a" } });

describe.skipIf(!testDbUrl)("bookmarks, notes and drill filters", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const author = uuid();
  const learner = uuid();
  const other = uuid();
  const archive = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);
  let item: string;
  let attempt: { id: string; questions: Array<{ id: string; stem: string }> };

  beforeAll(async () => {
    item = uuid();
    for (const u of [author, learner, other]) h.access.set(`${u}:${item}`, { kind: "quiz", archiveId: archive, status: "published", canAttempt: true, canWrite: u === author });
    for (const u of [author, learner, other]) h.archives.set(`${u}:${archive}`, { canRead: true, canWrite: u === author, quizzes: [{ id: item, title: "Quiz", status: "published", canAttempt: true, canWrite: u === author }] });
    await call(author, "PUT", `/v1/quizzes/${item}/config`, { shuffleQuestions: false });
    for (const [s, d] of [["Q1", "Hardware"], ["Q2", "Hardware"], ["Q3", "Networking"], ["Q4", "Networking"]]) await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq(s!, d!));
    attempt = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, { restart: true }));
  });

  const idOf = (stem: string) => attempt.questions.find((q) => q.stem === stem)!.id;

  it("bookmarks a question and keeps a private note", async () => {
    const r = await call(learner, "PUT", `/v1/questions/${idOf("Q3")}/mark`, { bookmarked: true, note: "mnemonic: please do not throw sausage pizza away" });
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ bookmarked: true });
    // Saving only the note leaves the bookmark alone.
    expect(json(await call(learner, "PUT", `/v1/questions/${idOf("Q3")}/mark`, { note: "new note" }))).toMatchObject({ bookmarked: true, note: "new note" });
    const again = json(await call(learner, "GET", `/v1/attempts/${attempt.id}`));
    expect(again.questions.find((q: any) => q.stem === "Q3")).toMatchObject({ bookmarked: true, note: "new note" });
    expect(again.questions.find((q: any) => q.stem === "Q1")).toMatchObject({ bookmarked: false, note: "" });
    const list = json(await call(learner, "GET", `/v1/marks?archive=${archive}`)).marks;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ stem: "Q3", bookmarked: true });
  });

  it("keeps marks private and only for questions you have been served", async () => {
    expect(json(await call(other, "GET", "/v1/marks")).marks).toEqual([]);
    expect((await call(other, "PUT", `/v1/questions/${idOf("Q3")}/mark`, { bookmarked: true })).statusCode).toBe(404);
    expect((await call(learner, "PUT", `/v1/questions/${idOf("Q3")}/mark`, {})).statusCode).toBe(400);
  });

  it("drills the bookmarked questions, one topic, or only what is new", async () => {
    await call(learner, "POST", `/v1/attempts/${attempt.id}/submit`);
    const b = await call(learner, "POST", "/v1/drills", { archiveId: archive, focus: "bookmarked", restart: true });
    expect(b.statusCode).toBe(201);
    expect(json(b).questions.map((q: any) => q.stem)).toEqual(["Q3"]);
    expect(json(b).questions[0].drillReason).toBe("bookmarked");
    const d = json(await call(learner, "POST", "/v1/drills", { archiveId: archive, domains: ["Hardware"], restart: true }));
    expect(d.questions.map((q: any) => q.stem).sort()).toEqual(["Q1", "Q2"]);
    expect(d.drill.domains).toEqual(["Hardware"]);
    // Everything was served but none answered, so all four still count as unseen.
    const u = json(await call(learner, "POST", "/v1/drills", { archiveId: archive, focus: "unseen", count: 10, restart: true }));
    expect(u.questions).toHaveLength(4);
    const none = await call(other, "POST", "/v1/drills", { archiveId: archive, focus: "bookmarked" });
    expect(none.statusCode).toBe(409);
  });

  it("lists the topics of a course for the practice builder", async () => {
    const r = json(await call(learner, "GET", `/v1/drill-topics?archive=${archive}`));
    expect(r.domains).toEqual([{ domain: "Hardware", questions: 2 }, { domain: "Networking", questions: 2 }]);
    expect(r.unsorted).toBe(0);
    expect((await call(uuid(), "GET", `/v1/drill-topics?archive=${archive}`)).statusCode).toBe(404);
  });
});

describe.skipIf(!testDbUrl)("confidence", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());
  it("stores how sure you were and returns it with the attempt", async () => {
    const u = uuid();
    const archive = uuid();
    const item = uuid();
    h.access.set(`${u}:${item}`, { kind: "quiz", archiveId: archive, status: "published", canAttempt: true, canWrite: true });
    const call = async (method: string, url: string, payload?: unknown) => h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u }), ...(payload !== undefined ? { payload: payload as any } : {}) });
    await call("POST", `/v1/quizzes/${item}/questions`, mcq("Only", "D"));
    const at = JSON.parse((await call("POST", `/v1/quizzes/${item}/attempts`, {})).body);
    const qid = at.questions[0].id;
    expect(at.questions[0].confidence).toBeNull();
    expect(JSON.parse((await call("PUT", `/v1/attempts/${at.id}/items/${qid}`, { confidence: 1 })).body)).toMatchObject({ saved: true, confidence: 1 });
    expect(JSON.parse((await call("GET", `/v1/attempts/${at.id}`)).body).questions[0].confidence).toBe(1);
    expect((await call("PUT", `/v1/attempts/${at.id}/items/${qid}`, { confidence: 4 })).statusCode).toBe(400);
    expect(JSON.parse((await call("PUT", `/v1/attempts/${at.id}/items/${qid}`, { confidence: null })).body).confidence).toBeNull();
  });
});
