import { HttpError, idParam, parse, uuidv7 } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { providerHttpError, type Ctx } from "../ctx.js";
import { MODEL_NAME, PROVIDERS, ProviderError, complete } from "../providers.js";

const MAX_CREDENTIALS = 10;
const createBody = z.object({
  provider: z.enum(PROVIDERS as [string, ...string[]]),
  label: z.string().trim().min(1).max(60),
  /** Write-only: accepted here, never returned by any endpoint. */
  secret: z.string().min(8).max(512).regex(/^\S+$/, "must not contain spaces"),
});
const prefsBody = z.object({
  defaultCredentialId: z.uuid().nullable().optional(),
  models: z.partialRecord(z.enum(PROVIDERS as [string, ...string[]]), z.string().regex(MODEL_NAME)).optional(),
});

/** The only view of a credential that exists: who, which provider, and the last 4 characters. */
const out = (c: Record<string, any>) => ({ id: c.id, provider: c.provider, kind: c.kind, label: c.label, last4: c.last4, createdAt: c.created_at, lastUsedAt: c.last_used_at });

export function credentialRoutes(ctx: Ctx) {
  const { pool } = ctx;
  return async (r: FastifyInstance) => {
    r.get("/v1/ai/status", async (req) => {
      const a = await ctx.actor(req);
      const { rows } = await pool.query("SELECT COALESCE(sum(requests), 0)::int AS n, COALESCE(sum(tokens_in + tokens_out), 0)::bigint AS tokens FROM ai.ai_usage WHERE user_id = $1 AND day = $2", [a.userId, ctx.now().toISOString().slice(0, 10)]);
      return {
        vault: ctx.vault !== null,
        providers: PROVIDERS,
        defaultModels: ctx.cfg.defaultModels,
        usage: { requestsToday: rows[0].n, tokensToday: Number(rows[0].tokens), dailyLimit: ctx.cfg.dailyRequests },
      };
    });

    // Identity always comes from the verified token. No route takes a user id, so there is nothing to point at someone else.
    r.get("/v1/ai/credentials", async (req) => {
      const a = await ctx.actor(req);
      const { rows } = await pool.query("SELECT * FROM ai.ai_credentials WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at", [a.userId]);
      return { credentials: rows.map(out) };
    });

    r.post("/v1/ai/credentials", { config: ctx.svc.limit }, async (req, reply) => {
      const a = await ctx.actor(req);
      const vault = ctx.requireVault();
      const body = parse(createBody, req.body);
      const { rows: n } = await pool.query("SELECT count(*)::int AS n FROM ai.ai_credentials WHERE user_id = $1 AND revoked_at IS NULL", [a.userId]);
      if (n[0].n >= MAX_CREDENTIALS) throw new HttpError(409, "too_many_credentials", { limit: MAX_CREDENTIALS });
      const id = uuidv7();
      const sealed = await vault.seal(a.userId, id, body.provider, body.secret);
      const { rows } = await pool.query(
        "INSERT INTO ai.ai_credentials (id, user_id, provider, label, ciphertext, dek_version, last4) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [id, a.userId, body.provider, body.label, sealed.ciphertext, sealed.dekVersion, body.secret.slice(-4)],
      );
      return reply.code(201).send(out(rows[0]));
    });

    r.delete("/v1/ai/credentials/:id", async (req, reply) => {
      const a = await ctx.actor(req);
      const { rowCount } = await pool.query("DELETE FROM ai.ai_credentials WHERE id = $1 AND user_id = $2", [idParam(req), a.userId]);
      if (!rowCount) throw new HttpError(404, "not_found");
      await pool.query("UPDATE ai.ai_preferences SET default_credential_id = NULL WHERE user_id = $1 AND default_credential_id = $2", [a.userId, idParam(req)]);
      return reply.code(204).send();
    });

    /** One tiny request to check the key works. Says only whether it did, never why in a way that could echo the key. */
    r.post("/v1/ai/credentials/:id/test", { config: ctx.svc.limit }, async (req) => {
      const a = await ctx.actor(req);
      await ctx.quota(a.userId);
      const cred = await ctx.credential(a, idParam(req));
      try {
        const res = await complete(cred.provider, { apiKey: cred.secret, model: cred.model, messages: [{ role: "user", content: "Reply with the single word OK." }], maxTokens: 16, signal: AbortSignal.timeout(20_000) }, ctx.cfg.baseUrls, ctx.fetch);
        await ctx.recordUsage(a.userId, cred.provider, cred.model, res.tokensIn, res.tokensOut);
        return { ok: true, provider: cred.provider, model: cred.model };
      } catch (e) {
        if (e instanceof ProviderError) return { ok: false, provider: cred.provider, model: cred.model, error: e.code };
        providerHttpError(e);
      }
    });

    r.get("/v1/ai/preferences", async (req) => {
      const a = await ctx.actor(req);
      const { rows } = await pool.query("SELECT * FROM ai.ai_preferences WHERE user_id = $1", [a.userId]);
      return { defaultCredentialId: rows[0]?.default_credential_id ?? null, models: rows[0]?.models ?? {}, defaultModels: ctx.cfg.defaultModels };
    });

    r.put("/v1/ai/preferences", async (req) => {
      const a = await ctx.actor(req);
      const body = parse(prefsBody, req.body);
      if (body.defaultCredentialId) {
        const { rows } = await pool.query("SELECT 1 FROM ai.ai_credentials WHERE id = $1 AND user_id = $2", [body.defaultCredentialId, a.userId]);
        if (!rows[0]) throw new HttpError(400, "invalid_request", { issues: ["defaultCredentialId: not one of your credentials"] });
      }
      const { rows: cur } = await pool.query("SELECT * FROM ai.ai_preferences WHERE user_id = $1", [a.userId]);
      const next = {
        cred: body.defaultCredentialId === undefined ? (cur[0]?.default_credential_id ?? null) : body.defaultCredentialId,
        models: body.models ? { ...(cur[0]?.models ?? {}), ...body.models } : (cur[0]?.models ?? {}),
      };
      await pool.query(
        `INSERT INTO ai.ai_preferences (user_id, default_credential_id, models) VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET default_credential_id = $2, models = $3, updated_at = now()`,
        [a.userId, next.cred, next.models],
      );
      return { defaultCredentialId: next.cred, models: next.models, defaultModels: ctx.cfg.defaultModels };
    });

    /** Forget everything: credentials and the data key (so nothing is recoverable even from a backup), conversations, jobs, settings. */
    r.delete("/v1/ai/me", async (req, reply) => {
      const a = await ctx.actor(req);
      if (ctx.vault) await ctx.vault.destroy(a.userId);
      else await pool.query("DELETE FROM ai.ai_credentials WHERE user_id = $1", [a.userId]);
      for (const t of ["ai_preferences", "ai_jobs", "ai_usage", "agent_threads"]) await pool.query(`DELETE FROM ai.${t} WHERE user_id = $1`, [a.userId]);
      return reply.code(204).send();
    });

    /** Operator task after a master key rotation. Re-wraps data keys only: an admin never sees or uses anyone's secrets. */
    r.post("/v1/ai/admin/rewrap-keys", async (req) => {
      const a = await ctx.actor(req);
      if (!ctx.isAdmin(a)) throw new HttpError(403, "forbidden");
      return { rewrapped: await ctx.requireVault().rewrapAll() };
    });
  };
}
