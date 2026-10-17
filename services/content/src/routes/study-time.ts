import { HttpError, idParam, parse, resolveZone, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RANK, loadArchive, need } from "../access.js";
import type { Ctx } from "../ctx.js";
import { csvField } from "../markdown.js";

const addBody = z.object({
  archiveId: z.uuid(),
  minutes: z.number().int().min(1).max(1440),
  /** YYYY-MM-DD; defaults to today in the caller's time zone. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(300).default(""),
  source: z.enum(["timer", "manual"]).default("manual"),
  tz: z.string().max(64).optional(),
});
const listQuery = z.object({ archive: z.uuid().optional(), days: z.coerce.number().int().min(1).max(3650).default(30), tz: z.string().max(64).optional() });

/** Your own study time log. Private to you; nobody else can read it. */
export function studyTimeRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    r.post("/v1/study/time", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const body = parse(addBody, req.body);
      need((await loadArchive(pool, a, body.archiveId)).rel, RANK.viewer);
      const zone = await resolveZone(pool, body.tz);
      const { rows: today } = await pool.query("SELECT to_char($1::timestamptz AT TIME ZONE $2, 'YYYY-MM-DD') AS d", [ctx.now(), zone]);
      const day = body.day ?? today[0].d;
      if (day > today[0].d) throw new HttpError(400, "invalid_request", { issues: ["day: study time cannot be logged for a future day"] });
      const { rows } = await pool.query(
        `INSERT INTO content.study_time (id, user_id, archive_id, day, minutes, note, source) VALUES ($1,$2,$3,$4::date,$5,$6,$7) RETURNING id, to_char(day, 'YYYY-MM-DD') AS day, minutes`,
        [uuidv7(), a.userId, body.archiveId, day, body.minutes, body.note, body.source],
      );
      return reply.code(201).send(rows[0]);
    });

    /** Totals for the last `days` days (default 30), per day and per course, plus the latest entries. */
    r.get("/v1/study/time", async (req) => {
      const a = await ctx.actor(req, "content:read");
      const q = parse(listQuery, req.query);
      const zone = await resolveZone(pool, q.tz);
      const args = [a.userId, q.archive ?? null, ctx.now(), q.days, zone];
      const since = `(date_trunc('day', $3::timestamptz AT TIME ZONE $5) - make_interval(days => $4::int - 1))::date`;
      const { rows: days } = await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS date, sum(minutes)::int AS minutes FROM content.study_time WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2) AND day >= ${since} GROUP BY day ORDER BY day`, args);
      const { rows: courses } = await pool.query(
        `SELECT t.archive_id, m.title, sum(t.minutes)::int AS minutes FROM content.study_time t JOIN content.master_items m ON m.id = t.archive_id AND m.deleted_at IS NULL
          WHERE t.user_id = $1 AND ($2::uuid IS NULL OR t.archive_id = $2) AND t.day >= ${since} GROUP BY t.archive_id, m.title ORDER BY sum(t.minutes) DESC`,
        args,
      );
      const { rows: entries } = await pool.query(
        `SELECT id, archive_id, to_char(day, 'YYYY-MM-DD') AS day, minutes, note, source FROM content.study_time WHERE user_id = $1 AND ($2::uuid IS NULL OR archive_id = $2) AND day >= ${since} ORDER BY day DESC, created_at DESC LIMIT 50`,
        args,
      );
      return {
        days: q.days,
        totalMinutes: days.reduce((s, d) => s + d.minutes, 0),
        byDay: days,
        byCourse: courses.map((c) => ({ archiveId: c.archive_id, title: c.title, minutes: c.minutes })),
        entries: entries.map((e) => ({ id: e.id, archiveId: e.archive_id, day: e.day, minutes: e.minutes, note: e.note, source: e.source })),
      };
    });

    r.delete("/v1/study/time/:id", async (req, reply) => {
      const a = await ctx.actor(req, "content:write");
      const { rowCount } = await pool.query("DELETE FROM content.study_time WHERE id = $1 AND user_id = $2", [idParam(req), a.userId]);
      if (!rowCount) throw new HttpError(404, "not_found");
      return reply.code(204).send();
    });

    /** Your whole log as CSV, newest first (capped at 100,000 rows). */
    r.get("/v1/study/time/export", async (req, reply) => {
      const a = await ctx.actor(req, "content:read");
      const { rows } = await pool.query(
        `SELECT to_char(t.day, 'YYYY-MM-DD') AS day, m.title AS course, t.minutes, t.note, t.source FROM content.study_time t LEFT JOIN content.master_items m ON m.id = t.archive_id
          WHERE t.user_id = $1 ORDER BY t.day DESC, t.created_at DESC LIMIT 100000`,
        [a.userId],
      );
      const safe = (v: string) => csvField(/^[=+\-@]/.test(v) ? `'${v}` : v);
      const lines = rows.map((x) => [x.day, safe(x.course ?? ""), x.minutes, safe(x.note), x.source].join(","));
      return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="ultimyr-study-time.csv"').send(["date,course,minutes,note,source", ...lines].join("\n") + "\n");
    });
  };
}
