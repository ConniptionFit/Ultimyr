import { grade, parseProfile, presentQuestion, selectQuestions, type Question, type ScoringProfile } from "@ultimyr/scoring";
import { HttpError, idParam, pageQuery, parse, tx, uuidv7 } from "@ultimyr/service-kit";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { z } from "zod";
import type { Actor, Ctx } from "../ctx.js";
import { DEFAULT_PROFILE_NAME } from "../profiles.js";
import { DEFAULT_CONFIG } from "./questions.js";

const startBody = z.object({
  /** Practice is always allowed; the quiz's own mode applies otherwise. */
  mode: z.enum(["practice"]).optional(),
  /** Authors can rehearse with unpublished questions included. */
  includeDrafts: z.boolean().default(false),
  /** Abandon any attempt already open and begin again. */
  restart: z.boolean().default(false),
});
const saveBody = z.object({
  response: z.unknown().optional(),
  flagged: z.boolean().optional(),
  timeMs: z.number().int().min(0).max(86_400_000).optional(),
});
const MAX_RESPONSE_BYTES = 50_000;

type Row = Record<string, any>;
/** The stored snapshot of a question: scoring fields plus the text the learner reads. */
type Snap = Question & { stem: string; explanation: string };

const toQuestion = (s: Snap): Question => ({ id: s.id, type: s.type, weight: s.weight, domain: s.domain, isPretest: s.isPretest, payload: s.payload, key: s.key }) as Question;

export function attemptRoutes(ctx: Ctx) {
  const { pool } = ctx;

  /** Grade an open attempt and close it. Safe to call twice: only the first caller wins. */
  async function finish(c: PoolClient, attempt: Row, status: "submitted" | "expired"): Promise<Row | null> {
    const profile = parseProfile(attempt.profile_snapshot);
    const { rows: items } = await c.query("SELECT * FROM quiz.attempt_items WHERE attempt_id = $1 ORDER BY ord", [attempt.id]);
    const questions = items.map((i) => toQuestion(i.question));
    const responses: Record<string, unknown> = {};
    for (const i of items) if (i.response !== null) responses[i.question_id] = i.response;
    const g = grade(profile, questions, responses);
    const at = status === "expired" && attempt.deadline_at ? attempt.deadline_at : ctx.now();
    const { rows } = await c.query(
      `UPDATE quiz.attempts SET status = $2, submitted_at = $3, raw_earned = $4, raw_max = $5, raw_bp = $6, scaled = $7, pass = $8, breakdown = $9
        WHERE id = $1 AND status = 'in_progress' RETURNING *`,
      [attempt.id, status, at, g.earned, g.max, g.rawBp, g.scaled, g.pass, { domains: g.domains, counts: g.counts }],
    );
    if (!rows[0]) return null;
    for (const it of g.items) {
      await c.query("UPDATE quiz.attempt_items SET points_awarded = $3, outcome = $4, grading = $5 WHERE attempt_id = $1 AND question_id = $2", [attempt.id, it.id, it.earned, it.outcome, { max: it.max, ...it.detail }]);
    }
    return rows[0];
  }

  const pastDeadline = (a: Row) => a.status === "in_progress" && a.deadline_at && ctx.now().getTime() > new Date(a.deadline_at).getTime() + a.grace_s * 1000;

  /** Load an attempt that belongs to the caller; an attempt past its deadline is closed on the spot. */
  async function mine(a: Actor, id: string): Promise<Row> {
    const { rows } = await pool.query("SELECT * FROM quiz.attempts WHERE id = $1 AND user_id = $2", [id, a.userId]);
    if (!rows[0]) throw new HttpError(404, "not_found");
    if (pastDeadline(rows[0])) {
      const done = await tx(pool, (c) => finish(c, rows[0], "expired"));
      if (done) return done;
      return (await pool.query("SELECT * FROM quiz.attempts WHERE id = $1", [id])).rows[0];
    }
    return rows[0];
  }

  const summary = (a: Row) => ({
    id: a.id,
    itemId: a.item_id,
    archiveId: a.archive_id,
    mode: a.mode,
    status: a.status,
    startedAt: a.started_at,
    deadlineAt: a.deadline_at,
    submittedAt: a.submitted_at,
    profile: { id: a.profile_id, name: a.profile_snapshot?.name, fidelity: a.profile_snapshot?.fidelity },
    ...(a.status === "in_progress"
      ? {}
      : { result: { earned: a.raw_earned, max: a.raw_max, rawBp: a.raw_bp, scaled: a.scaled, pass: a.pass, domains: a.breakdown?.domains ?? [], counts: a.breakdown?.counts ?? {} } }),
  });

  const feedback = (i: Row) => ({
    outcome: i.outcome,
    earned: i.points_awarded,
    max: i.grading?.max,
    detail: i.grading,
    explanation: (i.question as Snap).explanation,
    key: (i.question as Snap).key,
  });

  async function view(a: Row) {
    const { rows } = await pool.query("SELECT * FROM quiz.attempt_items WHERE attempt_id = $1 ORDER BY ord", [a.id]);
    return {
      ...summary(a),
      serverTime: ctx.now().toISOString(),
      questions: rows.map((i) => ({
        id: i.question_id,
        order: i.ord,
        ...(i.presented as object),
        response: i.response,
        flagged: i.flagged,
        timeMs: i.time_ms,
        // Feedback is only ever shown for questions the learner revealed (practice) or after the attempt closes.
        ...(i.revealed || a.status !== "in_progress" ? { feedback: feedback(i) } : {}),
      })),
    };
  }

  return async (r: FastifyInstance) => {
    r.post("/v1/quizzes/:id/attempts", { config: ctx.svc.limit }, async (req, reply) => {
      const a = await ctx.actor(req, "quiz:write");
      const itemId = idParam(req);
      const it = await ctx.quizItem(a, itemId, "attempt");
      const body = parse(startBody, req.body ?? {});
      if (it.status !== "published" && !it.canWrite) throw new HttpError(404, "not_found");

      const { rows: open } = await pool.query("SELECT * FROM quiz.attempts WHERE user_id = $1 AND item_id = $2 AND status = 'in_progress'", [a.userId, itemId]);
      for (const o of open) {
        if (pastDeadline(o) || body.restart) await tx(pool, (c) => finish(c, o, "expired"));
        else return reply.code(200).send({ ...(await view(o)), resumed: true });
      }

      const { rows: cfgRows } = await pool.query("SELECT * FROM quiz.quiz_config WHERE item_id = $1", [itemId]);
      const cfg = cfgRows[0] ?? { ...DEFAULT_CONFIG, item_id: itemId };
      const mode: string = body.mode ?? cfg.mode;
      const profileQ = cfg.scoring_profile_id
        ? await pool.query("SELECT * FROM quiz.scoring_profiles WHERE id = $1", [cfg.scoring_profile_id])
        : await pool.query("SELECT * FROM quiz.scoring_profiles WHERE is_official AND name = $1 ORDER BY version DESC LIMIT 1", [DEFAULT_PROFILE_NAME]);
      const profileRow = profileQ.rows[0];
      if (!profileRow) throw new HttpError(500, "internal_error");
      const profile: ScoringProfile = parseProfile(profileRow.definition);

      const wantDrafts = body.includeDrafts && it.canWrite;
      const { rows: pool_ } = await pool.query(
        "SELECT * FROM quiz.questions WHERE item_id = $1 AND ($2 OR status = 'published') ORDER BY ord, created_at",
        [itemId, wantDrafts],
      );
      if (!pool_.length) throw new HttpError(409, "no_questions");

      const seed = randomBytes(12).toString("hex");
      const chosen = selectQuestions(pool_, { count: mode === "practice" ? null : cfg.question_count, shuffle: cfg.shuffle_questions, seed });
      const now = ctx.now();
      const timed = mode !== "practice" && cfg.time_limit_s;
      const deadline = timed ? new Date(now.getTime() + cfg.time_limit_s * 1000) : null;
      const attemptId = uuidv7();

      await tx(pool, async (c) => {
        await c.query(
          `INSERT INTO quiz.attempts (id, user_id, item_id, archive_id, mode, profile_id, profile_snapshot, seed, started_at, deadline_at, grace_s)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [attemptId, a.userId, itemId, it.archiveId, mode, profileRow.id, profile, seed, now, deadline, cfg.grace_s],
        );
        for (const [ord, q] of chosen.entries()) {
          const snap: Snap = { id: q.id, type: q.type, weight: q.weight, domain: q.domain, isPretest: q.is_pretest, payload: q.payload, key: q.answer_key, stem: q.stem, explanation: q.explanation } as Snap;
          const shown = { ...presentQuestion(toQuestion(snap), seed, cfg.shuffle_options), stem: q.stem };
          // The learner never sees which questions are unscored pretests.
          delete (shown as Record<string, unknown>).isPretest;
          await c.query("INSERT INTO quiz.attempt_items (attempt_id, question_id, ord, question, presented) VALUES ($1,$2,$3,$4,$5)", [attemptId, q.id, ord, snap, shown]);
        }
      });
      const { rows } = await pool.query("SELECT * FROM quiz.attempts WHERE id = $1", [attemptId]);
      return reply.code(201).send(await view(rows[0]));
    });

    r.get("/v1/attempts/:id", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      return view(await mine(a, idParam(req)));
    });

    r.put("/v1/attempts/:id/items/:qid", async (req) => {
      const a = await ctx.actor(req, "quiz:write");
      const att = await mine(a, idParam(req));
      const qid = idParam(req, "qid");
      if (att.status !== "in_progress") throw new HttpError(409, "attempt_closed");
      const body = parse(saveBody, req.body);
      if (body.response !== undefined && JSON.stringify(body.response).length > MAX_RESPONSE_BYTES) throw new HttpError(413, "response_too_large");
      const sets: string[] = [];
      const vals: unknown[] = [att.id, qid];
      if (body.response !== undefined) sets.push(`response = $${vals.push(body.response)}`);
      if (body.flagged !== undefined) sets.push(`flagged = $${vals.push(body.flagged)}`);
      if (body.timeMs !== undefined) sets.push(`time_ms = GREATEST(time_ms, $${vals.push(body.timeMs)})`);
      if (!sets.length) throw new HttpError(400, "invalid_request", { issues: ["nothing to save"] });
      // A revealed practice answer is final: it can no longer be changed.
      const { rows } = await pool.query(`UPDATE quiz.attempt_items SET ${sets.join(", ")} WHERE attempt_id = $1 AND question_id = $2 AND NOT (revealed AND $${vals.push(body.response !== undefined)}::boolean) RETURNING question_id, flagged, time_ms`, vals);
      if (!rows[0]) {
        const { rows: ex } = await pool.query("SELECT revealed FROM quiz.attempt_items WHERE attempt_id = $1 AND question_id = $2", [att.id, qid]);
        if (ex[0]?.revealed) throw new HttpError(409, "already_revealed");
        throw new HttpError(404, "not_found");
      }
      return { saved: true, flagged: rows[0].flagged, timeMs: rows[0].time_ms, serverTime: ctx.now().toISOString() };
    });

    /** Practice mode only: grade one question now and show the answer and explanation. */
    r.post("/v1/attempts/:id/items/:qid/check", async (req) => {
      const a = await ctx.actor(req, "quiz:write");
      const att = await mine(a, idParam(req));
      const qid = idParam(req, "qid");
      if (att.status !== "in_progress") throw new HttpError(409, "attempt_closed");
      if (att.mode !== "practice") throw new HttpError(409, "feedback_not_available");
      const { rows } = await pool.query("SELECT * FROM quiz.attempt_items WHERE attempt_id = $1 AND question_id = $2", [att.id, qid]);
      const item = rows[0];
      if (!item) throw new HttpError(404, "not_found");
      const g = grade(parseProfile(att.profile_snapshot), [{ ...toQuestion(item.question), isPretest: false }], item.response === null ? {} : { [qid]: item.response });
      const res = g.items[0]!;
      const { rows: upd } = await pool.query(
        "UPDATE quiz.attempt_items SET revealed = true, points_awarded = $3, outcome = $4, grading = $5 WHERE attempt_id = $1 AND question_id = $2 RETURNING *",
        [att.id, qid, res.earned, res.outcome, { max: res.max, ...res.detail }],
      );
      return feedback(upd[0]);
    });

    r.post("/v1/attempts/:id/submit", async (req) => {
      const a = await ctx.actor(req, "quiz:write");
      const att = await mine(a, idParam(req));
      if (att.status === "in_progress") {
        const done = await tx(pool, (c) => finish(c, att, "submitted"));
        if (done) return summary(done);
        return summary((await pool.query("SELECT * FROM quiz.attempts WHERE id = $1", [att.id])).rows[0]);
      }
      // Submitting twice, or after the clock closed it, just returns the stored result.
      return summary(att);
    });

    /**
     * Server-sent clock for an open attempt: the server's time and the time left, every 10 seconds, so the page
     * can correct its own clock. Ends when the attempt closes (with a `closed` event) or after 5 minutes (reconnect).
     */
    r.get("/v1/attempts/:id/events", async (req, reply) => {
      const a = await ctx.actor(req, "quiz:read");
      const id = idParam(req);
      let att = await mine(a, id);
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const started = Date.now();
      let timer: ReturnType<typeof setInterval> | undefined;
      const end = () => {
        clearInterval(timer);
        if (!res.writableEnded) res.end();
      };
      const tick = async () => {
        try {
          att = await mine(a, id);
        } catch {
          return end();
        }
        const now = ctx.now();
        if (att.status !== "in_progress") {
          send("closed", { status: att.status, serverTime: now.toISOString() });
          return end();
        }
        send("tick", { serverTime: now.toISOString(), deadlineAt: att.deadline_at, remainingMs: att.deadline_at ? new Date(att.deadline_at).getTime() - now.getTime() : null });
        if (Date.now() - started > 300_000) end();
      };
      req.raw.on("close", end);
      await tick();
      if (!res.writableEnded) {
        timer = setInterval(() => void tick(), Number(process.env.QUIZ_SSE_INTERVAL_MS ?? 10_000));
        timer.unref();
      }
    });

    r.get("/v1/attempts/:id/review", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const att = await mine(a, idParam(req));
      if (att.status === "in_progress") throw new HttpError(409, "attempt_open");
      return view(att);
    });

    r.get("/v1/quizzes/:id/attempts", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const itemId = idParam(req);
      await ctx.quizItem(a, itemId, "attempt");
      const { limit, offset } = parse(pageQuery, req.query);
      const { rows } = await pool.query("SELECT * FROM quiz.attempts WHERE user_id = $1 AND item_id = $2 ORDER BY started_at DESC LIMIT $3 OFFSET $4", [a.userId, itemId, limit, offset]);
      return { attempts: rows.map(summary) };
    });

    r.get("/v1/attempts", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const { limit, offset } = parse(pageQuery, req.query);
      const { rows } = await pool.query("SELECT * FROM quiz.attempts WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3", [a.userId, limit, offset]);
      return { attempts: rows.map(summary) };
    });
  };
}

