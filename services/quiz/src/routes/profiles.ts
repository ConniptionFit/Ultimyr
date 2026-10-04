import { canonicalJson, grade, parseQuestion, type ScoringProfile } from "@ultimyr/scoring";
import { HttpError, idParam, parse, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Ctx } from "../ctx.js";
import { checksum, loadProfileDef, profileOr400, profileRow } from "../profiles.js";

const simulateBody = z.object({
  questions: z.array(z.unknown()).min(1).max(200),
  responses: z.record(z.string(), z.unknown()).default({}),
});

function runSimulation(profile: ScoringProfile, body: z.infer<typeof simulateBody>) {
  let questions;
  try {
    questions = body.questions.map((q) => parseQuestion(q));
  } catch (e) {
    throw new HttpError(400, "invalid_request", { issues: [e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : "invalid question"] });
  }
  return grade(profile, questions, body.responses);
}

export function profileRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    const visible = async (id: string, userId: string) => {
      const { rows } = await pool.query("SELECT * FROM quiz.scoring_profiles WHERE id = $1 AND (is_official OR owner_id = $2)", [id, userId]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      return rows[0];
    };

    r.get("/v1/scoring-profiles", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const { rows } = await pool.query("SELECT * FROM quiz.scoring_profiles WHERE is_official OR owner_id = $1 ORDER BY is_official DESC, name, version DESC", [a.userId]);
      return { profiles: rows.map(profileRow) };
    });

    r.get("/v1/scoring-profiles/:id", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      return profileRow(await visible(idParam(req), a.userId));
    });

    /** Profiles are immutable. Saving under an existing name makes the next version; old attempts keep their snapshot. */
    r.post("/v1/scoring-profiles", async (req, reply) => {
      const a = await ctx.actor(req, "quiz:write");
      if (!ctx.isAuthor(a)) throw new HttpError(403, "forbidden");
      const p = profileOr400(parse(z.object({ definition: z.unknown() }), req.body).definition);
      const { rows: prev } = await pool.query("SELECT COALESCE(max(version), 0) AS v FROM quiz.scoring_profiles WHERE owner_id = $1 AND name = $2", [a.userId, p.name]);
      const { rows } = await pool.query(
        "INSERT INTO quiz.scoring_profiles (id, owner_id, name, version, definition, checksum, is_official) VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING *",
        [uuidv7(), a.userId, p.name, Number(prev[0].v) + 1, canonicalJson(p), checksum(p)],
      );
      return reply.code(201).send(profileRow(rows[0]));
    });

    /** Try a profile you are still designing against sample questions and answers, without saving it. */
    r.post("/v1/scoring-profiles/simulate", async (req) => {
      await ctx.actor(req, "quiz:read");
      const body = req.body as Record<string, unknown>;
      const profile = profileOr400(body?.profile);
      return runSimulation(profile, parse(simulateBody, body));
    });

    r.post("/v1/scoring-profiles/:id/simulate", async (req) => {
      const a = await ctx.actor(req, "quiz:read");
      const row = await visible(idParam(req), a.userId);
      return runSimulation(loadProfileDef(row), parse(simulateBody, req.body));
    });
  };
}
