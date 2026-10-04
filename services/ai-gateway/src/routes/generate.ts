import { HttpError, idParam, pageQuery, parse } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import type { Ctx } from "../ctx.js";
import { generateBody, type JobRunner } from "../jobs.js";

const jobOut = (j: Record<string, any>) => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  error: j.error,
  result: j.result,
  provider: j.provider,
  model: j.model,
  tokensIn: j.tokens_in,
  tokensOut: j.tokens_out,
  createdAt: j.created_at,
  finishedAt: j.finished_at,
});

export function generateRoutes(ctx: Ctx, runner: JobRunner) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    /** Start generating a guide, deck or quiz. It lands as a draft in the archive for the caller (an editor) to review and publish. */
    r.post("/v1/ai/generate", { config: ctx.svc.limit }, async (req, reply) => {
      const a = await ctx.actor(req);
      ctx.requireVault();
      const input = parse(generateBody, req.body);
      await ctx.quota(a.userId);
      const access = await ctx.upstream("content", `/v1/access/archive/${input.archiveId}`, a.bearer);
      if (access.status === 401) throw new HttpError(401, "unauthenticated");
      if (access.status !== 200 || !access.json?.canWrite) throw new HttpError(404, "not_found");
      await ctx.credential(a, input.credentialId); // fail now, not later, if there is no usable key
      const { rows } = await pool.query("SELECT count(*)::int AS n FROM ai.ai_jobs WHERE user_id = $1 AND status IN ('queued', 'running')", [a.userId]);
      if (rows[0].n >= 3) throw new HttpError(429, "too_many_jobs");
      const jobId = await runner.submit(a, input);
      return reply.code(202).send({ jobId });
    });

    r.get("/v1/ai/jobs", async (req) => {
      const a = await ctx.actor(req);
      const { limit, offset } = parse(pageQuery, req.query);
      const { rows } = await pool.query("SELECT * FROM ai.ai_jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3", [a.userId, limit, offset]);
      return { jobs: rows.map(jobOut) };
    });

    r.get("/v1/ai/jobs/:id", async (req) => {
      const a = await ctx.actor(req);
      const { rows } = await pool.query("SELECT * FROM ai.ai_jobs WHERE id = $1 AND user_id = $2", [idParam(req), a.userId]);
      if (!rows[0]) throw new HttpError(404, "not_found");
      return jobOut(rows[0]);
    });
  };
}
