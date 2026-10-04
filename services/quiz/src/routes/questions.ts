import { questionBodySchema, questionProblems, type QuestionBody } from "@ultimyr/scoring";
import { HttpError, idParam, parse, tx, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../ctx.js";


const meta = z.object({
  stem: z.string().trim().min(1).max(10_000),
  explanation: z.string().max(10_000).default(""),
  difficulty: z.number().int().min(1).max(5).nullish(),
  domain: z.string().trim().max(100).nullish(),
  weight: z.number().int().min(1).max(100).default(1),
  isPretest: z.boolean().default(false),
  source: z.enum(["human", "ai", "mcp", "import"]).default("human"),
  status: z.enum(["draft", "published"]).optional(),
});
const patchMeta = meta.omit({ source: true }).partial();

const configBody = z.object({
  mode: z.enum(["practice", "timed", "exam_sim"]).optional(),
  timeLimitSeconds: z.number().int().min(60).max(28_800).nullable().optional(),
  questionCount: z.number().int().min(1).max(500).nullable().optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  scoringProfileId: z.uuid().nullable().optional(),
  graceSeconds: z.number().int().min(0).max(300).optional(),
});

function checked(body: unknown): QuestionBody {
  const b = parse(questionBodySchema, body);
  const problems = questionProblems(b);
  if (problems.length) throw new HttpError(400, "invalid_request", { issues: problems });
  return b;
}

/** The editor's view of a question: everything, including the answer key. */
export const questionOut = (q: Record<string, any>) => ({
  id: q.id,
  itemId: q.item_id,
  type: q.type,
  stem: q.stem,
  payload: q.payload,
  key: q.answer_key,
  explanation: q.explanation,
  difficulty: q.difficulty,
  domain: q.domain,
  weight: q.weight,
  isPretest: q.is_pretest,
  status: q.status,
  source: q.source,
  version: q.version,
  order: q.ord,
  createdAt: q.created_at,
  updatedAt: q.updated_at,
});

export const configOut = (c: Record<string, any>) => ({
  itemId: c.item_id,
  mode: c.mode,
  timeLimitSeconds: c.time_limit_s,
  questionCount: c.question_count,
  shuffleQuestions: c.shuffle_questions,
  shuffleOptions: c.shuffle_options,
  scoringProfileId: c.scoring_profile_id,
  graceSeconds: c.grace_s,
});

export const DEFAULT_CONFIG = { mode: "practice", time_limit_s: null, question_count: null, shuffle_questions: true, shuffle_options: true, scoring_profile_id: null, grace_s: 10 };

export function questionRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    /** Load a question and prove the caller may edit its quiz. */
    async function editable(req: Parameters<typeof ctx.actor>[0], scope: "quiz:read" | "quiz:write") {
      const a = await ctx.actor(req, scope);
      const { rows } = await pool.query("SELECT * FROM quiz.questions WHERE id = $1", [idParam(req)]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      await ctx.quizItem(a, rows[0].item_id, "write");
      return { a, q: rows[0] };
    }

    r.get("/v1/quizzes/:id/questions", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const itemId = idParam(req);
      await ctx.quizItem(a, itemId, "write");
      const { rows } = await pool.query("SELECT * FROM quiz.questions WHERE item_id = $1 ORDER BY ord, created_at", [itemId]);
      return { questions: rows.map(questionOut) };
    });

    r.post("/v1/quizzes/:id/questions", async (req, reply) => {
      const a = await ctx.actor(req, "quiz:write");
      const itemId = idParam(req);
      const it = await ctx.quizItem(a, itemId, "write");
      const m = parse(meta, req.body);
      const b = checked(req.body);
      // AI and MCP writes wait for a human to publish them.
      const status = m.status ?? (m.source === "ai" || m.source === "mcp" ? "draft" : "published");
      const { rows } = await pool.query(
        `INSERT INTO quiz.questions (id, item_id, archive_id, type, stem, payload, answer_key, explanation, difficulty, domain, weight, is_pretest, status, source, ord, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,(SELECT COALESCE(max(ord), 0) + 1 FROM quiz.questions WHERE item_id = $2),$15) RETURNING *`,
        [uuidv7(), itemId, it.archiveId, b.type, m.stem, b.payload, b.key, m.explanation, m.difficulty ?? null, m.domain || null, m.weight, m.isPretest, status, m.source, a.userId],
      );
      return reply.code(201).send(questionOut(rows[0]));
    });

    /** Up to 200 questions at once, all or nothing. Used by import and by AI and MCP writers. */
    r.post("/v1/quizzes/:id/questions/bulk", { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
      const a = await ctx.actor(req, "quiz:write");
      const itemId = idParam(req);
      const it = await ctx.quizItem(a, itemId, "write");
      const list = parse(z.object({ questions: z.array(z.unknown()).min(1).max(200) }), req.body).questions;
      const rows = await tx(pool, async (c) => {
        const out = [];
        for (const [i, raw] of list.entries()) {
          let m, b;
          try {
            m = parse(meta, raw);
            b = checked(raw);
          } catch (e) {
            if (e instanceof HttpError) throw new HttpError(400, "invalid_request", { index: i, issues: e.extra.issues });
            throw e;
          }
          const status = m.status ?? (m.source === "ai" || m.source === "mcp" ? "draft" : "published");
          const res = await c.query(
            `INSERT INTO quiz.questions (id, item_id, archive_id, type, stem, payload, answer_key, explanation, difficulty, domain, weight, is_pretest, status, source, ord, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,(SELECT COALESCE(max(ord), 0) + 1 FROM quiz.questions WHERE item_id = $2),$15) RETURNING *`,
            [uuidv7(), itemId, it.archiveId, b.type, m.stem, b.payload, b.key, m.explanation, m.difficulty ?? null, m.domain || null, m.weight, m.isPretest, status, m.source, a.userId],
          );
          out.push(res.rows[0]);
        }
        return out;
      });
      return reply.code(201).send({ questions: rows.map(questionOut) });
    });

    r.get("/v1/questions/:id", async (req) => questionOut((await editable(req, "quiz:read")).q));

    r.patch("/v1/questions/:id", async (req) => {
      const { q } = await editable(req, "quiz:write");
      const m = parse(patchMeta, req.body);
      const raw = req.body as Record<string, unknown>;
      const touchesBody = "type" in raw || "payload" in raw || "key" in raw;
      let b: QuestionBody | null = null;
      if (touchesBody) {
        if (!("type" in raw && "payload" in raw && "key" in raw)) throw new HttpError(400, "invalid_request", { issues: ["type, payload and key must be changed together"] });
        b = checked(raw);
      }
      const col: Record<string, unknown> = { stem: m.stem, explanation: m.explanation, difficulty: m.difficulty, domain: m.domain, weight: m.weight, is_pretest: m.isPretest, status: m.status };
      const set: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(col)) if (v !== undefined) set.push(`${k} = $${vals.push(v)}`);
      if (b) set.push(`type = $${vals.push(b.type)}`, `payload = $${vals.push(b.payload)}`, `answer_key = $${vals.push(b.key)}`);
      if (!set.length) return questionOut(q);
      vals.push(q.id);
      const { rows } = await pool.query(`UPDATE quiz.questions SET ${set.join(", ")}, version = version + 1, updated_at = now() WHERE id = $${vals.length} RETURNING *`, vals);
      return questionOut(rows[0]);
    });

    r.delete("/v1/questions/:id", async (req, reply) => {
      const { q } = await editable(req, "quiz:write");
      await pool.query("DELETE FROM quiz.questions WHERE id = $1", [q.id]);
      return reply.code(204).send();
    });

    /** Quiz settings. Learners may read them (timing and mode) but never the answer key. */
    r.get("/v1/quizzes/:id/config", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const itemId = idParam(req);
      const it = await ctx.quizItem(a, itemId, "attempt");
      const { rows } = await pool.query("SELECT * FROM quiz.quiz_config WHERE item_id = $1", [itemId]);
      const cfg = configOut(rows[0] ?? { ...DEFAULT_CONFIG, item_id: itemId });
      const { rows: n } = await pool.query("SELECT count(*)::int AS n FROM quiz.questions WHERE item_id = $1 AND status = 'published'", [itemId]);
      return { ...cfg, publishedQuestions: n[0].n, canEdit: it.canWrite };
    });

    r.put("/v1/quizzes/:id/config", async (req) => {
      const a = await ctx.actor(req, "quiz:write");
      const itemId = idParam(req);
      const it = await ctx.quizItem(a, itemId, "write");
      const body = parse(configBody, req.body);
      if (body.scoringProfileId) {
        const { rows } = await pool.query("SELECT 1 FROM quiz.scoring_profiles WHERE id = $1 AND (is_official OR owner_id = $2)", [body.scoringProfileId, a.userId]);
        if (!rows[0]) throw new HttpError(400, "invalid_request", { issues: ["scoringProfileId: unknown profile"] });
      }
      const { rows: cur } = await pool.query("SELECT * FROM quiz.quiz_config WHERE item_id = $1", [itemId]);
      const base = cur[0] ?? { ...DEFAULT_CONFIG, item_id: itemId };
      const next = {
        mode: body.mode ?? base.mode,
        time_limit_s: body.timeLimitSeconds === undefined ? base.time_limit_s : body.timeLimitSeconds,
        question_count: body.questionCount === undefined ? base.question_count : body.questionCount,
        shuffle_questions: body.shuffleQuestions ?? base.shuffle_questions,
        shuffle_options: body.shuffleOptions ?? base.shuffle_options,
        scoring_profile_id: body.scoringProfileId === undefined ? base.scoring_profile_id : body.scoringProfileId,
        grace_s: body.graceSeconds ?? base.grace_s,
      };
      if (next.mode !== "practice" && !next.time_limit_s) throw new HttpError(400, "invalid_request", { issues: ["timeLimitSeconds: timed and exam modes need a time limit"] });
      const { rows } = await pool.query(
        `INSERT INTO quiz.quiz_config (item_id, archive_id, mode, time_limit_s, question_count, shuffle_questions, shuffle_options, scoring_profile_id, grace_s)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (item_id) DO UPDATE SET mode = $3, time_limit_s = $4, question_count = $5, shuffle_questions = $6, shuffle_options = $7, scoring_profile_id = $8, grace_s = $9, updated_at = now()
         RETURNING *`,
        [itemId, it.archiveId, next.mode, next.time_limit_s, next.question_count, next.shuffle_questions, next.shuffle_options, next.scoring_profile_id, next.grace_s],
      );
      return configOut(rows[0]);
    });
  };
}

