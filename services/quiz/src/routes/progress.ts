import { HttpError, resolveZone, zoneDay, idParam, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { buildPlan } from "../plan.js";

const analyticsQuery = z.object({ archive: z.uuid().optional(), days: z.coerce.number().int().min(1).max(365).default(30), /** IANA time zone for day boundaries (UTC when missing or unknown). */ tz: z.string().max(64).optional() });
/** The day the plan starts from: the caller's local date when it is plausible (within one day of UTC), else the server's UTC date. */
export function planToday(now: Date, claimed?: string): string {
  const utc = now.toISOString().slice(0, 10);
  if (!claimed) return utc;
  const gap = Math.abs(Date.parse(`${claimed}T00:00:00Z`) - Date.parse(`${utc}T00:00:00Z`)) / 86_400_000;
  return gap <= 1 ? claimed : utc;
}

const planQuery = z.object({
  archive: z.uuid(),
  /** The exam date. Falls back to the date on the archive's goal. */
  examDate: z.iso.date().optional(),
  minutes: z.coerce.number().int().min(15).max(480).default(45),
  mode: z.enum(["unknown", "test_center", "online"]).default("unknown"),
  /** The person's own calendar day. Honoured only when it is within a day of the server's UTC date, so an evening in the Americas still counts as today. */
  today: z.iso.date().optional(),
});
const goalBody = z.object({
  targetBp: z.number().int().min(1).max(10_000),
  targetDate: z.iso.date().nullable().optional(),
});

const clampBp = (n: number) => Math.min(10_000, Math.max(0, Math.round(n)));
const ratioBp = (num: number, den: number) => (den > 0 ? clampBp((num * 10_000) / den) : 0);

export function progressRoutes(ctx: Ctx) {
  const { pool } = ctx;

  const goalOut = (g: Record<string, any>) => ({ archiveId: g.archive_id, targetBp: g.target_bp, targetDate: g.target_date ? new Date(g.target_date).toISOString().slice(0, 10) : null });

  /** Recency weighted average of the latest quiz attempts (drills are aimed at weak spots, so they would skew it). An estimate of readiness, never a prediction of the real exam. */
  async function readiness(userId: string, archive: string) {
    const { rows } = await pool.query(
      "SELECT raw_bp FROM quiz.attempts WHERE user_id = $1 AND archive_id = $2 AND kind = 'quiz' AND status <> 'in_progress' AND raw_max > 0 ORDER BY started_at DESC LIMIT 10",
      [userId, archive],
    );
    if (rows.length < 3) return { bp: null, basedOn: rows.length };
    const oldestFirst = rows.map((r) => r.raw_bp as number).reverse();
    const weights = oldestFirst.map((_, i) => i + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    return { bp: clampBp(oldestFirst.reduce((sum, bp, i) => sum + bp * weights[i]!, 0) / total), basedOn: rows.length };
  }

  return async (r: FastifyInstance) => {
    r.get("/v1/analytics", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const q = parse(analyticsQuery, req.query);
      const now = ctx.now();
      const since = new Date(now.getTime() - q.days * 86_400_000);
      const zone = await resolveZone(pool, q.tz);
      const args = [a.userId, since, q.archive ?? null];
      const argsTz = [...args, zone];
      const closed = "a.user_id = $1 AND a.status <> 'in_progress' AND a.started_at >= $2 AND ($3::uuid IS NULL OR a.archive_id = $3)";

      const { rows: daily } = await pool.query(
        `SELECT to_char(date_trunc('day', a.started_at AT TIME ZONE $4), 'YYYY-MM-DD') AS day, count(*)::int AS attempts,
                COALESCE(sum(a.raw_earned), 0)::bigint AS earned, COALESCE(sum(a.raw_max), 0)::bigint AS max
           FROM quiz.attempts a WHERE ${closed} GROUP BY 1 ORDER BY 1`,
        argsTz,
      );
      const { rows: mins } = await pool.query(
        `SELECT to_char(date_trunc('day', a.started_at AT TIME ZONE $4), 'YYYY-MM-DD') AS day, COALESCE(sum(ai.time_ms), 0)::bigint AS ms
           FROM quiz.attempts a JOIN quiz.attempt_items ai ON ai.attempt_id = a.id WHERE ${closed} GROUP BY 1`,
        argsTz,
      );
      const { rows: doms } = await pool.query(
        `SELECT COALESCE(ai.question->>'domain', 'General') AS domain, COALESCE(sum(ai.points_awarded), 0)::bigint AS earned,
                COALESCE(sum((ai.grading->>'max')::int), 0)::bigint AS max, count(*)::int AS questions,
                count(*) FILTER (WHERE ai.outcome = 'correct')::int AS correct
           FROM quiz.attempt_items ai JOIN quiz.attempts a ON a.id = ai.attempt_id
          WHERE ${closed} AND ai.outcome IS NOT NULL AND ai.outcome <> 'excluded' GROUP BY 1 ORDER BY 1`,
        args,
      );
      const { rows: active } = await pool.query(
        "SELECT DISTINCT to_char(date_trunc('day', started_at AT TIME ZONE $3), 'YYYY-MM-DD') AS day FROM quiz.attempts WHERE user_id = $1 AND status <> 'in_progress' AND started_at >= $2 ORDER BY 1 DESC",
        [a.userId, new Date(now.getTime() - 120 * 86_400_000), zone],
      );

      const minutesByDay = new Map(mins.map((m) => [m.day, Math.round(Number(m.ms) / 60_000)]));
      const series = daily.map((d) => ({ date: d.day, attempts: d.attempts, accuracyBp: ratioBp(Number(d.earned), Number(d.max)), minutes: minutesByDay.get(d.day) ?? 0 }));
      const totalEarned = daily.reduce((s, d) => s + Number(d.earned), 0);
      const totalMax = daily.reduce((s, d) => s + Number(d.max), 0);
      const domains = doms.map((d) => ({ domain: d.domain, accuracyBp: ratioBp(Number(d.earned), Number(d.max)), questions: d.questions, correct: d.correct }));
      const overallBp = ratioBp(totalEarned, totalMax);

      // Streak: consecutive active days ending today (or yesterday, so the day is not lost before you study).
      const days = new Set(active.map((x) => x.day));
      const iso = (t: number) => zoneDay(t, zone);
      let cursor = now.getTime();
      if (!days.has(iso(cursor))) cursor -= 86_400_000;
      let streakDays = 0;
      while (days.has(iso(cursor))) {
        streakDays++;
        cursor -= 86_400_000;
      }

      let ready = null;
      let goal = null;
      if (q.archive) {
        const est = await readiness(a.userId, q.archive);
        ready = { ...est, note: est.bp === null ? "Take at least 3 attempts for an estimate." : `Weighted toward your latest ${est.basedOn} attempts. It is an estimate of how you are doing, not a prediction of the real exam.` };
        const { rows } = await pool.query("SELECT * FROM quiz.goals WHERE user_id = $1 AND archive_id = $2", [a.userId, q.archive]);
        if (rows[0]) {
          const g = goalOut(rows[0]);
          const daysLeft = g.targetDate ? Math.ceil((new Date(`${g.targetDate}T23:59:59Z`).getTime() - now.getTime()) / 86_400_000) : null;
          goal = { ...g, daysLeft, gapBp: ready.bp === null ? null : Math.max(0, g.targetBp - ready.bp), onTrack: ready.bp === null ? null : ready.bp >= g.targetBp };
        }
      }

      return {
        range: { days: q.days, since: since.toISOString() },
        summary: {
          attempts: series.reduce((s, d) => s + d.attempts, 0),
          accuracyBp: overallBp,
          minutes: series.reduce((s, d) => s + d.minutes, 0),
          streakDays,
        },
        daily: series,
        domains,
        // Where to look first: the lowest scoring domains with enough questions behind them to mean something.
        weak: domains.filter((d) => d.questions >= 3).sort((x, y) => x.accuracyBp - y.accuracyBp).slice(0, 3),
        readiness: ready,
        goal,
      };
    });

    /**
     * The countdown plan to an exam date: phases, a task list for each day, advice from readiness and the goal, and an exam-day checklist.
     * Uses only the caller's own results, so it needs no archive access.
     */
    r.get("/v1/plan", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const q = parse(planQuery, req.query);
      const { rows: g } = await pool.query("SELECT target_bp, target_date FROM quiz.goals WHERE user_id = $1 AND archive_id = $2", [a.userId, q.archive]);
      const goalDate = g[0]?.target_date ? new Date(g[0].target_date).toISOString().slice(0, 10) : null;
      const examDate = q.examDate ?? goalDate;
      if (!examDate) throw new HttpError(400, "invalid_request", { issues: ["examDate: give the exam date, or set a goal date for this archive"] });
      const est = await readiness(a.userId, q.archive);
      const { rows: doms } = await pool.query(
        `SELECT COALESCE(ai.question->>'domain', 'General') AS domain, COALESCE(sum(ai.points_awarded), 0)::bigint AS earned, COALESCE(sum((ai.grading->>'max')::int), 0)::bigint AS max, count(*)::int AS questions
           FROM quiz.attempt_items ai JOIN quiz.attempts at ON at.id = ai.attempt_id
          WHERE at.user_id = $1 AND at.archive_id = $2 AND ai.outcome IS NOT NULL AND ai.outcome <> 'excluded' GROUP BY 1`,
        [a.userId, q.archive],
      );
      const weakAreas = doms
        .filter((d) => d.questions >= 3 && d.domain !== "General")
        .map((d) => ({ domain: d.domain as string, bp: ratioBp(Number(d.earned), Number(d.max)) }))
        .sort((x, y) => x.bp - y.bp || x.domain.localeCompare(y.domain))
        .slice(0, 4)
        .map((d) => d.domain);
      return { archiveId: q.archive, usedGoalDate: !q.examDate, ...buildPlan({ today: planToday(ctx.now(), q.today), examDate, readinessBp: est.bp, targetBp: g[0]?.target_bp ?? null, weakAreas, minutesPerDay: q.minutes, mode: q.mode }) };
    });

    /** Questions and the caller's own results for each exam objective of an archive, for the coverage map. */
    r.get("/v1/analytics/objectives", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const { archive: archiveId } = parse(z.object({ archive: z.uuid() }), req.query);
      const arc = await ctx.archiveAccess(a, archiveId);
      const itemIds = arc.quizzes.filter((x) => x.canAttempt && (x.status === "published" || x.canWrite)).map((x) => x.id);
      if (!itemIds.length) return { archiveId, objectives: [], unmapped: { questions: 0, drafts: 0, answered: 0, correct: 0, accuracyBp: null } };
      const { rows } = await pool.query(
        `SELECT q.objective_id, count(*) FILTER (WHERE q.status = 'published')::int AS questions, count(*) FILTER (WHERE q.status = 'draft')::int AS drafts,
                COALESCE(sum(st.answered), 0)::int AS answered, COALESCE(sum(st.correct), 0)::int AS correct
           FROM quiz.questions q
           LEFT JOIN LATERAL (
             SELECT count(*)::int AS answered, count(*) FILTER (WHERE ai.outcome = 'correct')::int AS correct
               FROM quiz.attempt_items ai JOIN quiz.attempts att ON att.id = ai.attempt_id
              WHERE ai.question_id = q.id AND att.user_id = $1 AND ai.outcome IN ('correct', 'partial', 'incorrect')) st ON true
          WHERE q.item_id = ANY($2::uuid[]) AND NOT q.is_pretest AND (q.status = 'published' OR ($3::boolean AND q.status = 'draft'))
          GROUP BY q.objective_id`,
        [a.userId, itemIds, arc.canWrite],
      );
      const out = (r: Record<string, any>) => ({ questions: r.questions as number, drafts: r.drafts as number, answered: r.answered as number, correct: r.correct as number, accuracyBp: r.answered > 0 ? ratioBp(r.correct, r.answered) : null });
      const unmapped = rows.find((r) => r.objective_id === null);
      return {
        archiveId,
        objectives: rows.filter((r) => r.objective_id !== null).map((r) => ({ objectiveId: r.objective_id as string, ...out(r) })),
        unmapped: unmapped ? out(unmapped) : { questions: 0, drafts: 0, answered: 0, correct: 0, accuracyBp: null },
      };
    });

    r.get("/v1/goals", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const { rows } = await pool.query("SELECT * FROM quiz.goals WHERE user_id = $1 ORDER BY updated_at DESC", [a.userId]);
      return { goals: rows.map(goalOut) };
    });

    r.get("/v1/goals/:id", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const { rows } = await pool.query("SELECT * FROM quiz.goals WHERE user_id = $1 AND archive_id = $2", [a.userId, idParam(req)]);
      return { goal: rows[0] ? goalOut(rows[0]) : null };
    });

    r.put("/v1/goals/:id", async (req) => {
      const a = await ctx.actor(req, "quiz:write");
      const body = parse(goalBody, req.body);
      if (body.targetDate && body.targetDate < ctx.now().toISOString().slice(0, 10)) throw new HttpError(400, "invalid_request", { issues: ["targetDate: pick a date that has not passed"] });
      const { rows } = await pool.query(
        `INSERT INTO quiz.goals (user_id, archive_id, target_bp, target_date) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, archive_id) DO UPDATE SET target_bp = $3, target_date = $4, updated_at = now() RETURNING *`,
        [a.userId, idParam(req), body.targetBp, body.targetDate ?? null],
      );
      return goalOut(rows[0]);
    });

    r.delete("/v1/goals/:id", async (req, reply) => {
      const a = await ctx.actor(req, "quiz:write");
      await pool.query("DELETE FROM quiz.goals WHERE user_id = $1 AND archive_id = $2", [a.userId, idParam(req)]);
      return reply.code(204).send();
    });
  };
}
