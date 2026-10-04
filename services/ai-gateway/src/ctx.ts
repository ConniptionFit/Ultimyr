import { hasRole } from "@ultimyr/authz";
import { HttpError, type Pool, type Principal, type Service } from "@ultimyr/service-kit";
import type { FastifyRequest } from "fastify";
import type { AiConfig } from "./config.js";
import { ProviderError, type Provider } from "./providers.js";
import type { Vault } from "./vault.js";

export interface Actor {
  userId: string;
  principal: Principal;
  bearer: string;
}

export type Upstream = (service: "content" | "quiz", path: string, bearer: string, init?: { method?: string; body?: unknown }) => Promise<{ status: number; json: any }>;

export interface Ctx {
  svc: Service;
  pool: Pool;
  cfg: AiConfig;
  vault: Vault | null;
  fetch: typeof fetch;
  upstream: Upstream;
  now(): Date;
  actor(req: FastifyRequest): Promise<Actor>;
  requireVault(): Vault;
  isAdmin(a: Actor): boolean;
  /** The caller's chosen credential (or default), decrypted for one call. Never store or return `secret`. */
  credential(a: Actor, requestedId?: string | null): Promise<{ id: string; provider: Provider; secret: string; model: string }>;
  quota(userId: string): Promise<void>;
  recordUsage(userId: string, provider: string, model: string, tokensIn: number, tokensOut: number): Promise<void>;
}

export function httpUpstream(cfg: AiConfig, fetchImpl: typeof fetch = fetch): Upstream {
  return async (service, path, bearer, init) => {
    const base = service === "content" ? cfg.contentUrl : cfg.quizUrl;
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: init?.method ?? "GET",
        headers: { authorization: `Bearer ${bearer}`, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new HttpError(503, `${service}_unavailable`);
    }
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

export function createCtx(svc: Service, pool: Pool, cfg: AiConfig, vault: Vault | null, opts: { fetch?: typeof fetch; upstream?: Upstream; now?: () => Date } = {}): Ctx {
  const fetchImpl = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const ctx: Ctx = {
    svc,
    pool,
    cfg,
    vault,
    fetch: fetchImpl,
    upstream: opts.upstream ?? httpUpstream(cfg, fetchImpl),
    now,
    async actor(req) {
      const principal = await svc.authorize(req, "ai:use");
      return { userId: principal.userId, principal, bearer: req.headers.authorization!.slice(7) };
    },
    requireVault() {
      if (!vault) throw new HttpError(503, "vault_unavailable");
      return vault;
    },
    isAdmin: (a) => hasRole(a.principal, "platform_admin"),
    async credential(a, requestedId) {
      const v = ctx.requireVault();
      let id = requestedId ?? null;
      if (!id) {
        const { rows } = await pool.query("SELECT default_credential_id FROM ai.ai_preferences WHERE user_id = $1", [a.userId]);
        id = rows[0]?.default_credential_id ?? null;
      }
      const { rows } = id
        ? await pool.query("SELECT * FROM ai.ai_credentials WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", [id, a.userId])
        : await pool.query("SELECT * FROM ai.ai_credentials WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at LIMIT 1", [a.userId]);
      const row = rows[0];
      if (!row) throw new HttpError(409, id ? "credential_not_found" : "no_credential");
      const secret = await v.open(a.userId, row.id, row.provider, row.ciphertext, row.dek_version);
      await pool.query("UPDATE ai.ai_credentials SET last_used_at = now() WHERE id = $1", [row.id]);
      const { rows: pref } = await pool.query("SELECT models FROM ai.ai_preferences WHERE user_id = $1", [a.userId]);
      const provider = row.provider as Provider;
      return { id: row.id, provider, secret, model: pref[0]?.models?.[provider] ?? cfg.defaultModels[provider] };
    },
    async quota(userId) {
      const { rows } = await pool.query("SELECT COALESCE(sum(requests), 0)::int AS n FROM ai.ai_usage WHERE user_id = $1 AND day = $2", [userId, now().toISOString().slice(0, 10)]);
      if (rows[0].n >= cfg.dailyRequests) throw new HttpError(429, "daily_limit", { limit: cfg.dailyRequests });
    },
    async recordUsage(userId, provider, model, tokensIn, tokensOut) {
      await pool.query(
        `INSERT INTO ai.ai_usage (user_id, day, provider, model, requests, tokens_in, tokens_out) VALUES ($1,$2,$3,$4,1,$5,$6)
         ON CONFLICT (user_id, day, provider, model) DO UPDATE SET requests = ai.ai_usage.requests + 1, tokens_in = ai.ai_usage.tokens_in + $5, tokens_out = ai.ai_usage.tokens_out + $6`,
        [userId, now().toISOString().slice(0, 10), provider, model, tokensIn, tokensOut],
      );
    },
  };
  return ctx;
}

/** Turn a provider failure into an HTTP error with a safe code. */
export function providerHttpError(e: unknown): never {
  if (e instanceof ProviderError) throw new HttpError(e.code === "rate_limited" ? 429 : e.code === "credential_rejected" ? 422 : 502, e.code);
  throw e;
}
