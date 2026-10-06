import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

const opts = ["a", "b", "c"].map((id) => ({ id, text: id }));
const mcq = (stem: string, domain: string, extra: Record<string, unknown> = {}) => ({ type: "mcq", stem, domain, payload: { options: opts }, key: { correct: "a" }, ...extra });

describe.skipIf(!testDbUrl)("weak-area drills, objective stats and the countdown plan", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const author = uuid();
  const learner = uuid();
  const stranger = uuid();
  const archive = uuid();
  const call = async (u: string, method: string, url: string, payload?: unknown, scopes?: string[]) =>
    h.app.inject({ method: method as any, url, headers: await h.issuer.bearer({ userId: u, ...(scopes ? { scopes } : {}) }), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  /** A quiz in the archive that both the author and the learner can use. */
  function quiz(status = "published") {
    const id = uuid();
    h.access.set(`${author}:${id}`, { kind: "quiz", archiveId: archive, status, canAttempt: true, canWrite: true });
    h.access.set(`${learner}:${id}`, { kind: "quiz", archiveId: archive, status, canAttempt: true, canWrite: false });
    return id;
  }
  const quizzesFor = (ids: Array<{ id: string; status?: string }>, canWrite: boolean) =>
    ids.map((q) => ({ id: q.id, title: "Quiz", status: q.status ?? "published", canAttempt: true, canWrite }));
  function grant(ids: Array<{ id: string; status?: string }>) {
    h.archives.set(`${author}:${archive}`, { canRead: true, canWrite: true, quizzes: quizzesFor(ids, true) });
    h.archives.set(`${learner}:${archive}`, { canRead: true, canWrite: false, quizzes: quizzesFor(ids, false) });
  }
  const drill = (u: string, body: Record<string, unknown> = {}) => {
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    return call(u, "POST", "/v1/drills", { archiveId: archive, ...body });
  };

  let item: string;
  const objA = uuid();
  const objB = uuid();
  beforeAll(async () => {
    item = quiz();
    grant([{ id: item }]);
    await call(author, "PUT", `/v1/quizzes/${item}/config`, { shuffleQuestions: false });
    const qs: Array<[string, string, string?]> = [["A1", "Hardware", objA], ["A2", "Hardware", objA], ["A3", "Hardware", objA], ["B1", "Networking", objB], ["B2", "Networking", objB], ["B3", "Networking", objB]];
    for (const [stem, domain, obj] of qs) expect((await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq(stem, domain, { objectiveId: obj }))).statusCode).toBe(201);
    // One draft and one unscored pretest that a drill must never use.
    await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("DRAFT", "Hardware", { status: "draft" }));
    await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("PRETEST", "Hardware", { isPretest: true }));
  });

  /** Take the quiz, answering all Hardware right and all Networking wrong. */
  async function takeQuiz() {
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    const at = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, { restart: true }));
    for (const q of at.questions) await call(learner, "PUT", `/v1/attempts/${at.id}/items/${q.id}`, { response: { choice: q.stem.startsWith("A") ? "a" : "b" } });
    return json(await call(learner, "POST", `/v1/attempts/${at.id}/submit`));
  }

  it("needs access to the archive and questions to drill", async () => {
    expect((await drill(stranger)).statusCode).toBe(404);
    expect((await call(learner, "POST", "/v1/drills", { archiveId: "nope" })).statusCode).toBe(400);
    expect((await call(learner, "POST", "/v1/drills", { archiveId: archive, count: 2 })).statusCode).toBe(400);
    expect((await call(learner, "POST", "/v1/drills", { archiveId: archive, focus: "other" })).statusCode).toBe(400);
    expect((await call(learner, "POST", "/v1/drills", { archiveId: archive }, ["quiz:read"])).statusCode).toBe(403);
    const empty = uuid();
    h.archives.set(`${learner}:${empty}`, { canRead: true, canWrite: false, quizzes: [] });
    expect((await call(learner, "POST", "/v1/drills", { archiveId: empty })).statusCode).toBe(409);
  });

  it("builds a drill from published scored questions only, as an instant-feedback practice attempt", async () => {
    const res = await drill(learner, { count: 50, restart: true });
    expect(res.statusCode).toBe(201);
    const d = json(res);
    expect(d).toMatchObject({ kind: "drill", mode: "practice", status: "in_progress", archiveId: archive, itemId: archive, drill: { focus: "mixed", objectiveId: null } });
    expect(d.deadlineAt).toBeNull();
    expect(d.questions.map((q: any) => q.stem).sort()).toEqual(["A1", "A2", "A3", "B1", "B2", "B3"]);
    expect(d.questions.every((q: any) => q.drillReason === "not_seen")).toBe(true);
    // The learner never gets the key before checking.
    expect(JSON.stringify(d)).not.toContain('"correct"');
    const q = d.questions[0];
    await call(learner, "PUT", `/v1/attempts/${d.id}/items/${q.id}`, { response: { choice: "a" } });
    const checked = json(await call(learner, "POST", `/v1/attempts/${d.id}/items/${q.id}/check`));
    expect(checked.outcome).toBe("correct");
    const done = json(await call(learner, "POST", `/v1/attempts/${d.id}/submit`));
    expect(done).toMatchObject({ kind: "drill", status: "submitted" });
    expect(json(await call(learner, "GET", "/v1/attempts")).attempts[0]).toMatchObject({ id: d.id, kind: "drill" });
  });

  it("resumes an open drill unless asked to restart", async () => {
    const a = json(await drill(learner, { restart: true }));
    const b = await drill(learner);
    expect(b.statusCode).toBe(200);
    expect(json(b)).toMatchObject({ id: a.id, resumed: true });
    const c = await drill(learner, { restart: true });
    expect(c.statusCode).toBe(201);
    expect(json(c).id).not.toBe(a.id);
    expect(json(await call(learner, "GET", `/v1/attempts/${a.id}`)).status).toBe("expired");
  });

  it("aims at what was missed, and drills never count toward readiness", async () => {
    await call(learner, "POST", "/v1/drills", { archiveId: archive, restart: true }); // close any open drill
    for (let i = 0; i < 3; i++) await takeQuiz();
    const before = json(await call(learner, "GET", `/v1/analytics?archive=${archive}`)).readiness;
    expect(before.basedOn).toBe(3);

    const missed = json(await drill(learner, { focus: "missed", count: 10, restart: true }));
    expect(missed.questions.map((q: any) => q.stem).sort()).toEqual(["B1", "B2", "B3"]);
    expect(missed.questions.every((q: any) => q.drillReason === "missed")).toBe(true);

    const mixed = json(await drill(learner, { count: 4, restart: true }));
    expect(mixed.questions).toHaveLength(4);
    expect(mixed.questions.filter((q: any) => q.stem.startsWith("B")).length).toBeGreaterThanOrEqual(2);

    const weak = json(await drill(learner, { focus: "weak", count: 5, restart: true }));
    expect(weak.questions.every((q: any) => q.stem.startsWith("B"))).toBe(true);

    // Finish a drill, getting every one right: readiness still rests on the three real quizzes.
    for (const q of weak.questions) await call(learner, "PUT", `/v1/attempts/${weak.id}/items/${q.id}`, { response: { choice: "a" } });
    await call(learner, "POST", `/v1/attempts/${weak.id}/submit`);
    const after = json(await call(learner, "GET", `/v1/analytics?archive=${archive}`)).readiness;
    expect(after).toEqual(before);
  });

  it("narrows a drill to one exam objective and refuses when nothing matches", async () => {
    const d = json(await drill(learner, { objectiveId: objA, count: 10, restart: true }));
    expect(d.drill.objectiveId).toBe(objA);
    expect(d.questions.map((q: any) => q.stem).sort()).toEqual(["A1", "A2", "A3"]);
    const none = await drill(learner, { objectiveId: uuid(), restart: true });
    expect(none.statusCode).toBe(409);
    expect(json(none).error).toBe("no_questions");
  });

  it("says so when there is nothing to redo", async () => {
    // A learner with no history has no misses.
    const fresh = uuid();
    h.access.set(`${fresh}:${item}`, { kind: "quiz", archiveId: archive, status: "published", canAttempt: true, canWrite: false });
    h.archives.set(`${fresh}:${archive}`, { canRead: true, canWrite: false, quizzes: quizzesFor([{ id: item }], false) });
    const res = await call(fresh, "POST", "/v1/drills", { archiveId: archive, focus: "missed" });
    expect(res.statusCode).toBe(409);
    expect(json(res)).toMatchObject({ error: "nothing_to_drill" });
  });

  it("only uses quizzes the caller may attempt, and drafts only for editors who can write", async () => {
    const draftQuiz = quiz("draft");
    await call(author, "POST", `/v1/quizzes/${draftQuiz}/questions`, mcq("D-ONLY", "Hardware", { status: "published" }));
    grant([{ id: item }, { id: draftQuiz, status: "draft" }]);
    // The learner's access list (built by the content service) leaves out a draft quiz they cannot write.
    h.archives.set(`${learner}:${archive}`, { canRead: true, canWrite: false, quizzes: quizzesFor([{ id: item }], false) });
    const l = json(await drill(learner, { count: 50, restart: true }));
    expect(l.questions.map((q: any) => q.stem)).not.toContain("D-ONLY");
    const a = json(await drill(author, { count: 50, restart: true }));
    expect(a.questions.map((q: any) => q.stem)).toContain("D-ONLY");
    grant([{ id: item }]);
  });

  it("reports questions and results per objective, counting drafts only for writers", async () => {
    const s = json(await call(learner, "GET", `/v1/analytics/objectives?archive=${archive}`));
    const byId = Object.fromEntries(s.objectives.map((o: any) => [o.objectiveId, o]));
    expect(byId[objA]).toMatchObject({ questions: 3, drafts: 0 });
    expect(byId[objB]).toMatchObject({ questions: 3, drafts: 0 });
    expect(byId[objA].accuracyBp).toBeGreaterThan(byId[objB].accuracyBp);
    expect(s.unmapped).toMatchObject({ questions: 0, drafts: 0 }); // the draft and the unscored pretest are not shown to a learner
    const w = json(await call(author, "GET", `/v1/analytics/objectives?archive=${archive}`));
    expect(w.unmapped).toMatchObject({ questions: 0, drafts: 1 });
    expect(w.unmapped.accuracyBp).toBeNull();
    expect((await call(stranger, "GET", `/v1/analytics/objectives?archive=${archive}`)).statusCode).toBe(404);
  });

  it("links a question to an objective through the question api", async () => {
    const created = json(await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("LINKED", "Hardware", { objectiveId: objB })));
    expect(created.objectiveId).toBe(objB);
    const moved = json(await call(author, "PATCH", `/v1/questions/${created.id}`, { objectiveId: objA }));
    expect(moved.objectiveId).toBe(objA);
    expect(json(await call(author, "PATCH", `/v1/questions/${created.id}`, { objectiveId: null })).objectiveId).toBeNull();
    expect((await call(author, "PATCH", `/v1/questions/${created.id}`, { objectiveId: "nope" })).statusCode).toBe(400);
    await call(author, "DELETE", `/v1/questions/${created.id}`);
  });

  it("builds a countdown plan from a date or the goal date, using the learner's own results", async () => {
    h.clock.now = new Date("2026-10-04T12:00:00Z");
    const need = await call(learner, "GET", `/v1/plan?archive=${archive}`);
    expect(need.statusCode).toBe(400);
    const p = json(await call(learner, "GET", `/v1/plan?archive=${archive}&examDate=2026-10-14&mode=online&minutes=60`));
    expect(p).toMatchObject({ archiveId: archive, usedGoalDate: false, daysLeft: 10, status: "upcoming", phase: "consolidate" });
    expect(p.days).toHaveLength(11);
    // A learner whose evening is still the 3rd gets the 3rd; a wildly different day is ignored.
    const local = json(await call(learner, "GET", `/v1/plan?archive=${archive}&examDate=2026-10-14&today=2026-10-03`));
    expect(local.daysLeft).toBe(11);
    const bogus = json(await call(learner, "GET", `/v1/plan?archive=${archive}&examDate=2026-10-14&today=2026-01-01`));
    expect(bogus.daysLeft).toBe(10);
    expect(p.checklist.join(" ")).toContain("system check");
    expect(p.readiness.bp).not.toBeNull();
    // Networking was missed, so it is the first weak topic named.
    expect(p.days.flatMap((d: any) => d.tasks).find((t: any) => t.focus === "weak").title).toContain("Networking");

    await call(learner, "PUT", `/v1/goals/${archive}`, { targetBp: 8000, targetDate: "2026-10-20" });
    const g = json(await call(learner, "GET", `/v1/plan?archive=${archive}`));
    expect(g).toMatchObject({ usedGoalDate: true, examDate: "2026-10-20", daysLeft: 16 });
    expect(g.readiness.targetBp).toBe(8000);
    expect(g.readiness.gapBp).toBeGreaterThan(0);

    expect((await call(learner, "GET", `/v1/plan?archive=${archive}&examDate=10-14`)).statusCode).toBe(400);
    expect((await call(learner, "GET", `/v1/plan?archive=${archive}&examDate=2026-10-14&minutes=5`)).statusCode).toBe(400);
    expect((await call(learner, "GET", "/v1/plan?examDate=2026-10-14")).statusCode).toBe(400);
    expect((await call(learner, "GET", `/v1/plan?archive=${archive}&examDate=2026-10-14`, undefined, ["content:read"])).statusCode).toBe(403);
    // Someone with no results still gets a plan, and an honest note about it.
    const empty = json(await call(stranger, "GET", `/v1/plan?archive=${archive}&examDate=2026-10-14`));
    expect(empty.readiness.bp).toBeNull();
    expect(empty.advice[0]).toContain("at least 3 practice attempts");
  });
});
