import { HttpError, idParam, parse, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../ctx.js";

const KINDS = ["wrong_answer", "unclear", "typo", "outdated", "other"] as const;
const reportBody = z.object({ kind: z.enum(KINDS), message: z.string().trim().max(2000).default("") });
const resolveBody = z.object({ resolution: z.string().trim().max(1000).default("") });

/** Question quality: learners report problems, and editors see how each question performs across everyone's answers. */
export function qualityRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    /** Report a problem with a question you were served in one of your own attempts. Reporting again replaces your open report. */
    r.post("/v1/questions/:id/report", { config: ctx.svc.limit }, async (req, reply) => {
      const a = await ctx.actor(req, "quiz:write");
      const id = idParam(req);
      const body = parse(reportBody, req.body);
      const { rows } = await pool.query(
        `SELECT q.item_id, q.archive_id FROM quiz.questions q
          WHERE q.id = $2 AND EXISTS (SELECT 1 FROM quiz.attempt_items ai JOIN quiz.attempts att ON att.id = ai.attempt_id WHERE ai.question_id = q.id AND att.user_id = $1)`,
        [a.userId, id],
      );
      if (!rows[0]) throw new HttpError(404, "not_found");
      const { rows: saved } = await pool.query(
        `INSERT INTO quiz.question_reports (id, question_id, item_id, archive_id, user_id, kind, message) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, question_id) WHERE status = 'open' DO UPDATE SET kind = $6, message = $7, created_at = now() RETURNING id`,
        [uuidv7(), id, rows[0].item_id, rows[0].archive_id, a.userId, body.kind, body.message],
      );
      return reply.code(201).send({ id: saved[0].id, questionId: id, kind: body.kind });
    });

    /** Open or resolved reports on a quiz's questions (editors). Reporters are not identified. */
    r.get("/v1/quizzes/:id/reports", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const itemId = idParam(req);
      await ctx.quizItem(a, itemId, "write");
      const q = parse(z.object({ status: z.enum(["open", "resolved"]).default("open") }), req.query);
      const { rows } = await pool.query(
        `SELECT r.id, r.question_id, r.kind, r.message, r.status, r.created_at, r.resolution, qq.stem
           FROM quiz.question_reports r JOIN quiz.questions qq ON qq.id = r.question_id
          WHERE r.item_id = $1 AND r.status = $2 ORDER BY r.created_at DESC LIMIT 200`,
        [itemId, q.status],
      );
      return { reports: rows.map((x) => ({ id: x.id, questionId: x.question_id, stem: x.stem, kind: x.kind, message: x.message, status: x.status, createdAt: x.created_at, resolution: x.resolution })) };
    });

    r.post("/v1/reports/:id/resolve", async (req) => {
      const a = await ctx.actor(req, "quiz:write");
      const id = idParam(req);
      const body = parse(resolveBody, req.body ?? {});
      const { rows } = await pool.query("SELECT item_id FROM quiz.question_reports WHERE id = $1", [id]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      await ctx.quizItem(a, rows[0].item_id, "write");
      await pool.query("UPDATE quiz.question_reports SET status = 'resolved', resolved_at = $2, resolved_by = $3, resolution = $4 WHERE id = $1 AND status = 'open'", [id, ctx.now(), a.userId, body.resolution]);
      return { id, status: "resolved" };
    });

    /**
     * How each question performs across everyone's finished answers (editors): answers, share correct, average time,
     * how many different people answered, and which options people picked. Partial credit counts as an answer but not as correct.
     */
    r.get("/v1/quizzes/:id/item-analysis", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const itemId = idParam(req);
      await ctx.quizItem(a, itemId, "write");
      const { rows } = await pool.query(
        `SELECT ai.question_id, count(*)::int AS answers, count(*) FILTER (WHERE ai.outcome = 'correct')::int AS correct,
                round(avg(NULLIF(ai.time_ms, 0)))::int AS avg_ms, count(DISTINCT att.user_id)::int AS people
           FROM quiz.attempt_items ai
           JOIN quiz.questions q ON q.id = ai.question_id AND q.item_id = $1
           JOIN quiz.attempts att ON att.id = ai.attempt_id AND att.status <> 'in_progress'
          WHERE ai.outcome IN ('correct', 'partial', 'incorrect') GROUP BY ai.question_id`,
        [itemId],
      );
      const { rows: picks } = await pool.query(
        `SELECT question_id, option_id, count(*)::int AS n FROM (
           SELECT ai.question_id, ai.response->>'choice' AS option_id FROM quiz.attempt_items ai
             JOIN quiz.questions q ON q.id = ai.question_id AND q.item_id = $1 JOIN quiz.attempts att ON att.id = ai.attempt_id AND att.status <> 'in_progress'
            WHERE ai.outcome IN ('correct', 'partial', 'incorrect') AND q.type = 'mcq'
           UNION ALL
           SELECT ai.question_id, o FROM quiz.attempt_items ai
             JOIN quiz.questions q ON q.id = ai.question_id AND q.item_id = $1 JOIN quiz.attempts att ON att.id = ai.attempt_id AND att.status <> 'in_progress',
             LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(ai.response->'choices') = 'array' THEN ai.response->'choices' ELSE '[]'::jsonb END) AS o
            WHERE ai.outcome IN ('correct', 'partial', 'incorrect') AND q.type = 'multi') s
          WHERE option_id IS NOT NULL GROUP BY question_id, option_id`,
        [itemId],
      );
      const { rows: open } = await pool.query("SELECT question_id, count(*)::int AS n FROM quiz.question_reports WHERE item_id = $1 AND status = 'open' GROUP BY question_id", [itemId]);
      const optionPicks = new Map<string, Record<string, number>>();
      for (const p of picks) optionPicks.set(p.question_id, { ...(optionPicks.get(p.question_id) ?? {}), [p.option_id]: p.n });
      return {
        questions: rows.map((x) => ({ questionId: x.question_id, answers: x.answers, people: x.people, correctBp: Math.round((x.correct * 10_000) / x.answers), avgMs: x.avg_ms, picks: optionPicks.get(x.question_id) ?? {} })),
        openReports: Object.fromEntries(open.map((x) => [x.question_id, x.n])),
      };
    });
  };
}
