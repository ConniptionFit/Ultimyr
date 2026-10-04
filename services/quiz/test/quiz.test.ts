import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, testDbUrl, uuid, type Harness } from "./helpers.js";

const opts = (ids: string[]) => ids.map((id) => ({ id, text: `option ${id}` }));
const mcq = (stem: string, correct = "a", extra: Record<string, unknown> = {}) => ({ type: "mcq", stem, explanation: `because ${correct}`, payload: { options: opts(["a", "b", "c"]) }, key: { correct }, ...extra });

describe.skipIf(!testDbUrl)("quiz service", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  const author = uuid();
  const learner = uuid();
  const stranger = uuid();
  const archive = uuid();
  const as = (u: string, extra: { roles?: any; scopes?: string[] } = {}) => h.issuer.bearer({ userId: u, ...extra });
  const call = async (u: string, method: string, url: string, payload?: unknown, extra?: { roles?: any; scopes?: string[] }) =>
    h.app.inject({ method: method as any, url, headers: await as(u, extra), ...(payload !== undefined ? { payload: payload as any } : {}) });
  const json = (r: { body: string }) => JSON.parse(r.body);

  /** A quiz item the author edits and the learner may attempt. */
  function newQuiz(status = "published") {
    const id = uuid();
    h.access.set(`${author}:${id}`, { kind: "quiz", archiveId: archive, status, canAttempt: true, canWrite: true });
    h.access.set(`${learner}:${id}`, { kind: "quiz", archiveId: archive, status, canAttempt: true, canWrite: false });
    return id;
  }
  async function addQuestions(item: string, n: number, extra: Record<string, unknown> = {}) {
    for (let i = 0; i < n; i++) expect((await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq(`Question ${i + 1}`, "a", extra))).statusCode).toBe(201);
  }

  it("requires a token and the right scope", async () => {
    const item = newQuiz();
    expect((await h.app.inject({ url: `/v1/quizzes/${item}/questions` })).statusCode).toBe(401);
    const r = await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("x"), { scopes: ["quiz:read"] });
    expect(r.statusCode).toBe(403);
    expect((await call(author, "GET", `/api/v1/quizzes/${item}/questions`)).statusCode).toBe(200);
  });

  describe("questions", () => {
    it("lets editors create, read, change and delete, and hides everything from others", async () => {
      const item = newQuiz();
      const created = await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("Which port is HTTPS?", "b", { difficulty: 2, domain: "Networking", weight: 2 }));
      expect(created.statusCode).toBe(201);
      const q = json(created);
      expect(q).toMatchObject({ type: "mcq", status: "published", key: { correct: "b" }, domain: "Networking", weight: 2, version: 1 });

      expect((await call(learner, "GET", `/v1/quizzes/${item}/questions`)).statusCode).toBe(404);
      expect((await call(learner, "GET", `/v1/questions/${q.id}`)).statusCode).toBe(404);
      expect((await call(stranger, "GET", `/v1/questions/${q.id}`)).statusCode).toBe(404);
      expect((await call(learner, "PATCH", `/v1/questions/${q.id}`, { stem: "hax" })).statusCode).toBe(404);
      expect((await call(learner, "DELETE", `/v1/questions/${q.id}`)).statusCode).toBe(404);

      const patched = json(await call(author, "PATCH", `/v1/questions/${q.id}`, { stem: "Which port does HTTPS use?", weight: 3 }));
      expect(patched).toMatchObject({ stem: "Which port does HTTPS use?", weight: 3, version: 2 });
      const rekeyed = await call(author, "PATCH", `/v1/questions/${q.id}`, { type: "mcq", payload: { options: opts(["a", "b"]) }, key: { correct: "a" } });
      expect(json(rekeyed)).toMatchObject({ key: { correct: "a" }, version: 3 });
      expect((await call(author, "PATCH", `/v1/questions/${q.id}`, { key: { correct: "a" } })).statusCode).toBe(400);
      expect((await call(author, "PATCH", `/v1/questions/${q.id}`, {})).statusCode).toBe(200);

      expect((await call(author, "DELETE", `/v1/questions/${q.id}`)).statusCode).toBe(204);
      expect((await call(author, "GET", `/v1/questions/${q.id}`)).statusCode).toBe(404);
    });

    it("rejects questions whose key does not match the options", async () => {
      const item = newQuiz();
      const r = await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("Bad", "zzz"));
      expect(r.statusCode).toBe(400);
      expect(json(r).issues).toContain("correct answer zzz is not an option");
      expect((await call(author, "POST", `/v1/quizzes/${item}/questions`, { type: "essay", stem: "x", payload: {}, key: {} })).statusCode).toBe(400);
      expect((await call(author, "POST", `/v1/quizzes/${item}/questions`, { type: "mcq", payload: { options: opts(["a", "b"]) }, key: { correct: "a" } })).statusCode).toBe(400);
    });

    it("refuses items that are not quizzes or that the caller cannot edit", async () => {
      const guide = uuid();
      h.access.set(`${author}:${guide}`, { kind: "guide", archiveId: archive, status: "published", canAttempt: true, canWrite: true });
      expect((await call(author, "POST", `/v1/quizzes/${guide}/questions`, mcq("x"))).statusCode).toBe(404);
      expect((await call(author, "POST", `/v1/quizzes/${uuid()}/questions`, mcq("x"))).statusCode).toBe(404);
      expect((await call(author, "POST", `/v1/quizzes/not-a-uuid/questions`, mcq("x"))).statusCode).toBe(404);
    });

    it("puts AI and MCP written questions in draft and keeps drafts out of attempts", async () => {
      const item = newQuiz();
      await addQuestions(item, 1);
      const ai = json(await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("From the AI", "a", { source: "ai" })));
      const mcp = json(await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("From MCP", "a", { source: "mcp" })));
      expect([ai.status, mcp.status]).toEqual(["draft", "draft"]);
      const started = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {}));
      expect(started.questions).toHaveLength(1);
      await call(author, "PATCH", `/v1/questions/${ai.id}`, { status: "published" });
      const again = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, { restart: true }));
      expect(again.questions).toHaveLength(2);
      const rehearsal = json(await call(author, "POST", `/v1/quizzes/${item}/attempts`, { includeDrafts: true }));
      expect(rehearsal.questions).toHaveLength(3);
    });

    it("bulk creates all or nothing", async () => {
      const item = newQuiz();
      const bad = await call(author, "POST", `/v1/quizzes/${item}/questions/bulk`, { questions: [mcq("ok"), mcq("bad", "nope")] });
      expect(bad.statusCode).toBe(400);
      expect(json(bad).index).toBe(1);
      expect(json(await call(author, "GET", `/v1/quizzes/${item}/questions`)).questions).toHaveLength(0);
      const good = await call(author, "POST", `/v1/quizzes/${item}/questions/bulk`, { questions: [mcq("one"), mcq("two", "c")] });
      expect(good.statusCode).toBe(201);
      expect(json(good).questions.map((q: any) => q.order)).toEqual([1, 2]);
      expect((await call(author, "POST", `/v1/quizzes/${item}/questions/bulk`, { questions: [] })).statusCode).toBe(400);
    });
  });

  describe("config", () => {
    it("defaults to practice, validates, and shows learners only what they need", async () => {
      const item = newQuiz();
      await addQuestions(item, 2);
      const def = json(await call(learner, "GET", `/v1/quizzes/${item}/config`));
      expect(def).toMatchObject({ mode: "practice", timeLimitSeconds: null, shuffleQuestions: true, publishedQuestions: 2, canEdit: false });
      expect((await call(learner, "PUT", `/v1/quizzes/${item}/config`, { mode: "timed" })).statusCode).toBe(404);
      expect((await call(author, "PUT", `/v1/quizzes/${item}/config`, { mode: "timed" })).statusCode).toBe(400);
      const ok = await call(author, "PUT", `/v1/quizzes/${item}/config`, { mode: "timed", timeLimitSeconds: 600, questionCount: 5 });
      expect(json(ok)).toMatchObject({ mode: "timed", timeLimitSeconds: 600, questionCount: 5 });
      const later = json(await call(author, "PUT", `/v1/quizzes/${item}/config`, { shuffleOptions: false }));
      expect(later).toMatchObject({ mode: "timed", timeLimitSeconds: 600, shuffleOptions: false });
      expect((await call(author, "PUT", `/v1/quizzes/${item}/config`, { scoringProfileId: uuid() })).statusCode).toBe(400);
      expect((await call(author, "PUT", `/v1/quizzes/${item}/config`, { timeLimitSeconds: 5 })).statusCode).toBe(400);
    });
  });

  describe("scoring profiles", () => {
    it("ships honest official profiles and lets authors save immutable versions", async () => {
      const list = json(await call(learner, "GET", "/v1/scoring-profiles")).profiles;
      expect(list.filter((p: any) => p.official).length).toBeGreaterThanOrEqual(3);
      expect(list.find((p: any) => p.fidelity === "community_estimate").source).toMatch(/unpublished/);
      const def = { name: "My profile", pass: { kind: "percent", minBp: 6000 }, types: { multi: "penalty" } };
      expect((await call(learner, "POST", "/v1/scoring-profiles", { definition: def }, { roles: ["learner"] })).statusCode).toBe(403);
      const v1 = json(await call(author, "POST", "/v1/scoring-profiles", { definition: def }));
      const v2 = json(await call(author, "POST", "/v1/scoring-profiles", { definition: { ...def, pass: { kind: "percent", minBp: 7000 } } }));
      expect([v1.version, v2.version, v1.official]).toEqual([1, 2, false]);
      expect(v1.checksum).not.toBe(v2.checksum);
      expect((await call(author, "GET", `/v1/scoring-profiles/${v1.id}`)).statusCode).toBe(200);
      expect((await call(stranger, "GET", `/v1/scoring-profiles/${v1.id}`)).statusCode).toBe(404);
      const bad = await call(author, "POST", "/v1/scoring-profiles", { definition: { name: "x", pass: { kind: "scaled", min: 5 } } });
      expect(bad.statusCode).toBe(400);
      expect(json(bad).issues.join()).toMatch(/scale/);
      expect(json(await call(author, "GET", "/v1/scoring-profiles")).profiles.some((p: any) => p.id === v1.id)).toBe(true);
    });

    it("simulates saved and unsaved profiles with a traceable breakdown", async () => {
      const profiles = json(await call(learner, "GET", "/v1/scoring-profiles")).profiles;
      const scaled = profiles.find((p: any) => p.definition.scale);
      const questions = [
        { id: "q1", type: "mcq", weight: 1, payload: { options: opts(["a", "b"]) }, key: { correct: "a" } },
        { id: "q2", type: "mcq", weight: 1, payload: { options: opts(["a", "b"]) }, key: { correct: "a" } },
      ];
      const sim = json(await call(learner, "POST", `/v1/scoring-profiles/${scaled.id}/simulate`, { questions, responses: { q1: { choice: "a" }, q2: { choice: "b" } } }));
      expect(sim).toMatchObject({ earned: 1000, max: 2000, rawBp: 5000, scaled: 500, pass: false });
      expect(sim.items.map((i: any) => i.outcome)).toEqual(["correct", "incorrect"]);
      const inline = json(await call(learner, "POST", "/v1/scoring-profiles/simulate", { profile: { name: "p", pass: { kind: "percent", minBp: 5000 } }, questions, responses: { q1: { choice: "a" } } }));
      expect(inline).toMatchObject({ rawBp: 5000, pass: true });
      expect((await call(learner, "POST", "/v1/scoring-profiles/simulate", { profile: { nope: 1 }, questions, responses: {} })).statusCode).toBe(400);
      expect((await call(learner, "POST", `/v1/scoring-profiles/${scaled.id}/simulate`, { questions: [{ id: "x", type: "essay" }], responses: {} })).statusCode).toBe(400);
      expect((await call(learner, "POST", `/v1/scoring-profiles/${uuid()}/simulate`, { questions, responses: {} })).statusCode).toBe(404);
    });
  });

  describe("attempts", () => {
    it("runs a practice attempt: no answer key leaks, feedback on request, grading on submit", async () => {
      const item = newQuiz();
      await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("Q1", "a", { domain: "Hardware" }));
      await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("Q2", "b", { domain: "Networking", isPretest: true }));
      await call(author, "POST", `/v1/quizzes/${item}/questions`, { type: "fib", stem: "Name the protocol", explanation: "It is TCP.", payload: { blanks: 1 }, key: { blanks: [{ accepted: ["tcp"] }] } });

      const res = await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {});
      expect(res.statusCode).toBe(201);
      const at = json(res);
      expect(at).toMatchObject({ mode: "practice", status: "in_progress", deadlineAt: null });
      expect(res.body).not.toContain('"key"');
      expect(res.body).not.toContain("because");
      expect(res.body).not.toContain("isPretest");
      expect(at.questions).toHaveLength(3);
      const byStem = (s: string) => at.questions.find((q: any) => q.stem === s);
      const q1 = byStem("Q1");
      const fib = byStem("Name the protocol");

      expect((await call(stranger, "GET", `/v1/attempts/${at.id}`)).statusCode).toBe(404);
      expect((await call(learner, "GET", `/v1/attempts/${at.id}/review`)).statusCode).toBe(409);

      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${q1.id}`, { response: { choice: "a" }, flagged: true, timeMs: 4200 })).statusCode).toBe(200);
      await call(learner, "PUT", `/v1/attempts/${at.id}/items/${fib.id}`, { response: { blanks: ["UDP"] } });
      const fb = json(await call(learner, "POST", `/v1/attempts/${at.id}/items/${q1.id}/check`));
      expect(fb).toMatchObject({ outcome: "correct", earned: 1000, explanation: "because a", key: { correct: "a" } });
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${q1.id}`, { response: { choice: "b" } })).statusCode).toBe(409);
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${q1.id}`, { flagged: false })).statusCode).toBe(200);

      const resumed = json(await call(learner, "GET", `/v1/attempts/${at.id}`));
      expect(resumed.questions.find((q: any) => q.id === q1.id)).toMatchObject({ flagged: false, response: { choice: "a" }, feedback: { outcome: "correct" } });
      expect(resumed.questions.find((q: any) => q.id === fib.id).feedback).toBeUndefined();

      const done = json(await call(learner, "POST", `/v1/attempts/${at.id}/submit`));
      expect(done.status).toBe("submitted");
      // The pretest is unscored, the fib is wrong, so 1 of 2 scored questions: 50%.
      expect(done.result).toMatchObject({ earned: 1000, max: 2000, rawBp: 5000, pass: false, counts: { correct: 1, incorrect: 1, excluded: 1 } });
      expect(done.result.domains.map((d: any) => d.domain)).toEqual(["General", "Hardware"]);
      expect(json(await call(learner, "POST", `/v1/attempts/${at.id}/submit`))).toEqual(done);
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${fib.id}`, { response: { blanks: ["tcp"] } })).statusCode).toBe(409);

      const review = json(await call(learner, "GET", `/v1/attempts/${at.id}/review`));
      expect(review.questions.find((q: any) => q.id === fib.id).feedback).toMatchObject({ outcome: "incorrect", explanation: "It is TCP.", key: { blanks: [{ accepted: ["tcp"] }] } });
      expect(json(await call(learner, "GET", `/v1/quizzes/${item}/attempts`)).attempts[0].id).toBe(at.id);
      expect(json(await call(learner, "GET", "/v1/attempts")).attempts.some((a: any) => a.id === at.id)).toBe(true);
      expect(json(await call(stranger, "GET", "/v1/attempts")).attempts).toEqual([]);
    });

    it("keeps the attempt's own copy of the question when it is edited or deleted later", async () => {
      const item = newQuiz();
      const q = json(await call(author, "POST", `/v1/quizzes/${item}/questions`, mcq("Original", "a")));
      const at = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {}));
      await call(author, "PATCH", `/v1/questions/${q.id}`, { type: "mcq", payload: { options: opts(["a", "b", "c"]) }, key: { correct: "c" } });
      await call(author, "DELETE", `/v1/questions/${q.id}`);
      await call(learner, "PUT", `/v1/attempts/${at.id}/items/${q.id}`, { response: { choice: "a" } });
      const done = json(await call(learner, "POST", `/v1/attempts/${at.id}/submit`));
      expect(done.result.rawBp).toBe(10_000);
      expect(done.result.pass).toBe(true);
    });

    it("resumes an open attempt instead of starting another, and restart replaces it", async () => {
      const item = newQuiz();
      await addQuestions(item, 2);
      const first = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {}));
      const second = await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {});
      expect(second.statusCode).toBe(200);
      expect(json(second)).toMatchObject({ id: first.id, resumed: true });
      const fresh = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, { restart: true }));
      expect(fresh.id).not.toBe(first.id);
      expect(json(await call(learner, "GET", `/v1/attempts/${first.id}`)).status).toBe("expired");
    });

    it("needs questions and permission to start", async () => {
      const empty = newQuiz();
      expect((await call(learner, "POST", `/v1/quizzes/${empty}/attempts`, {})).statusCode).toBe(409);
      expect((await call(stranger, "POST", `/v1/quizzes/${empty}/attempts`, {})).statusCode).toBe(404);
      const draft = newQuiz("draft");
      await addQuestions(draft, 1);
      expect((await call(learner, "POST", `/v1/quizzes/${draft}/attempts`, {})).statusCode).toBe(404);
      expect((await call(author, "POST", `/v1/quizzes/${draft}/attempts`, { includeDrafts: true })).statusCode).toBe(201);
      expect((await call(learner, "POST", `/v1/quizzes/${empty}/attempts`, { mode: "exam_sim" })).statusCode).toBe(400);
    });

    it("enforces the server timer: no feedback, grace window, then closed and graded as of the deadline", async () => {
      const item = newQuiz();
      await addQuestions(item, 4);
      await call(author, "PUT", `/v1/quizzes/${item}/config`, { mode: "exam_sim", timeLimitSeconds: 600, questionCount: 3, graceSeconds: 5, shuffleQuestions: false });
      h.clock.now = new Date("2026-10-04T12:00:00Z");
      const at = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {}));
      expect(at).toMatchObject({ mode: "exam_sim", deadlineAt: "2026-10-04T12:10:00.000Z", serverTime: "2026-10-04T12:00:00.000Z" });
      expect(at.questions).toHaveLength(3);
      const [q1, q2] = at.questions;
      expect((await call(learner, "POST", `/v1/attempts/${at.id}/items/${q1.id}/check`)).statusCode).toBe(409);

      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${q1.id}`, { response: { choice: "a" } })).statusCode).toBe(200);
      h.clock.now = new Date("2026-10-04T12:10:04Z"); // inside the grace window
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${q2.id}`, { response: { choice: "a" } })).statusCode).toBe(200);
      h.clock.now = new Date("2026-10-04T12:10:06Z"); // past it
      const late = await call(learner, "PUT", `/v1/attempts/${at.id}/items/${q2.id}`, { response: { choice: "b" } });
      expect(late.statusCode).toBe(409);
      const closed = json(await call(learner, "GET", `/v1/attempts/${at.id}`));
      expect(closed).toMatchObject({ status: "expired", submittedAt: "2026-10-04T12:10:00.000Z" });
      expect(closed.result).toMatchObject({ earned: 2000, max: 3000, rawBp: 6667 });
      expect(json(await call(learner, "POST", `/v1/attempts/${at.id}/submit`)).status).toBe("expired");

      // starting again closes any stale open attempt and gives a fresh clock
      const next = await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {});
      expect(next.statusCode).toBe(201);
      h.clock.now = new Date("2026-10-04T13:00:00Z");
      const stale = await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {});
      expect(stale.statusCode).toBe(201);
      expect(json(stale).id).not.toBe(json(next).id);
    });

    it("snapshots the scoring profile so later changes never move past results", async () => {
      const item = newQuiz();
      await addQuestions(item, 2);
      const pid = json(await call(author, "POST", "/v1/scoring-profiles", { definition: { name: "Snap", pass: { kind: "percent", minBp: 5000 } } })).id;
      await call(author, "PUT", `/v1/quizzes/${item}/config`, { scoringProfileId: pid });
      const at = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {}));
      expect(at.profile).toMatchObject({ id: pid, name: "Snap" });
      await call(author, "PUT", `/v1/quizzes/${item}/config`, { scoringProfileId: null });
      await call(learner, "PUT", `/v1/attempts/${at.id}/items/${at.questions[0].id}`, { response: { choice: "a" } });
      const done = json(await call(learner, "POST", `/v1/attempts/${at.id}/submit`));
      expect(done.result).toMatchObject({ rawBp: 5000, pass: true });
      await h.pool.query("UPDATE quiz.scoring_profiles SET definition = jsonb_set(definition, '{pass,minBp}', '9000') WHERE id = $1", [pid]);
      expect(json(await call(learner, "GET", `/v1/attempts/${at.id}/review`)).result.pass).toBe(true);
    });

    it("shuffles options per attempt but only within the learner's own copy", async () => {
      const item = newQuiz();
      await call(author, "POST", `/v1/quizzes/${item}/questions`, { type: "mcq", stem: "Pick", payload: { options: opts(["a", "b", "c", "d", "e", "f"]) }, key: { correct: "a" } });
      const orders = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const at = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, { restart: true }));
        orders.add(at.questions[0].payload.options.map((o: any) => o.id).join(""));
        expect(at.questions[0].payload.options).toHaveLength(6);
      }
      expect(orders.size).toBeGreaterThan(1);
    });

    it("validates saves and caps response size", async () => {
      const item = newQuiz();
      await addQuestions(item, 1);
      const at = json(await call(learner, "POST", `/v1/quizzes/${item}/attempts`, {}));
      const qid = at.questions[0].id;
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${qid}`, {})).statusCode).toBe(400);
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${uuid()}`, { flagged: true })).statusCode).toBe(404);
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${qid}`, { response: { choice: "a".repeat(60_000) } })).statusCode).toBe(413);
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${qid}`, { timeMs: -5 })).statusCode).toBe(400);
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${qid}`, { timeMs: 1500 })).statusCode).toBe(200);
      expect((await call(learner, "PUT", `/v1/attempts/${at.id}/items/${qid}`, { timeMs: 500 })).statusCode).toBe(200);
      expect(json(await call(learner, "GET", `/v1/attempts/${at.id}`)).questions[0].timeMs).toBe(1500);
    });
  });
});
