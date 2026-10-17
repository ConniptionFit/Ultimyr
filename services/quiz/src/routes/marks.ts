import { HttpError, idParam, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../ctx.js";

const markBody = z.object({ bookmarked: z.boolean().optional(), note: z.string().max(2000).optional() });

/** Private bookmarks and notes on questions. Only questions you have been served in one of your own attempts can be marked. */
export function markRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    r.put("/v1/questions/:id/mark", async (req) => {
      const a = await ctx.actor(req, "quiz:write");
      const id = idParam(req);
      const body = parse(markBody, req.body);
      if (body.bookmarked === undefined && body.note === undefined) throw new HttpError(400, "invalid_request", { issues: ["nothing to save"] });
      const { rows: seen } = await pool.query(
        `SELECT q.archive_id FROM quiz.questions q
          WHERE q.id = $2 AND EXISTS (SELECT 1 FROM quiz.attempt_items ai JOIN quiz.attempts att ON att.id = ai.attempt_id WHERE ai.question_id = q.id AND att.user_id = $1)`,
        [a.userId, id],
      );
      if (!seen[0]) throw new HttpError(404, "not_found");
      const { rows } = await pool.query(
        `INSERT INTO quiz.question_marks (user_id, question_id, archive_id, bookmarked, note) VALUES ($1,$2,$3,COALESCE($4,false),COALESCE($5,''))
         ON CONFLICT (user_id, question_id) DO UPDATE SET bookmarked = COALESCE($4, quiz.question_marks.bookmarked), note = COALESCE($5, quiz.question_marks.note), updated_at = now()
         RETURNING bookmarked, note`,
        [a.userId, id, seen[0].archive_id, body.bookmarked ?? null, body.note ?? null],
      );
      return { questionId: id, bookmarked: rows[0].bookmarked, note: rows[0].note };
    });

    /** Your bookmarked or annotated questions, newest first. */
    r.get("/v1/marks", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const q = parse(z.object({ archive: z.uuid().optional(), bookmarked: z.enum(["true", "false"]).optional() }), req.query);
      const { rows } = await pool.query(
        `SELECT m.question_id, m.archive_id, m.bookmarked, m.note, qq.item_id, qq.stem, qq.domain
           FROM quiz.question_marks m JOIN quiz.questions qq ON qq.id = m.question_id
          WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.archive_id = $2) AND (m.bookmarked OR m.note <> '') AND ($3::boolean IS NOT TRUE OR m.bookmarked)
          ORDER BY m.updated_at DESC LIMIT 500`,
        [a.userId, q.archive ?? null, q.bookmarked === "true" ? true : null],
      );
      return { marks: rows.map((x) => ({ questionId: x.question_id, archiveId: x.archive_id, itemId: x.item_id, stem: x.stem, domain: x.domain, bookmarked: x.bookmarked, note: x.note })) };
    });

    /** The topics (question domains) in a course you can attempt, with how many published questions each has, for building a custom practice set. */
    r.get("/v1/drill-topics", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const { archive: archiveId } = parse(z.object({ archive: z.uuid() }), req.query);
      const arc = await ctx.archiveAccess(a, archiveId);
      const itemIds = arc.quizzes.filter((x) => x.canAttempt && (x.status === "published" || x.canWrite)).map((x) => x.id);
      const { rows } = await pool.query(
        `SELECT coalesce(domain, '') AS domain, count(*)::int AS questions FROM quiz.questions
          WHERE item_id = ANY($1::uuid[]) AND status = 'published' AND NOT is_pretest GROUP BY 1 ORDER BY 1`,
        [itemIds],
      );
      return { domains: rows.filter((x) => x.domain !== "").map((x) => ({ domain: x.domain, questions: x.questions })), unsorted: rows.find((x) => x.domain === "")?.questions ?? 0 };
    });
  };
}
