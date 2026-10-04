import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import { drizzle } from "drizzle-orm/node-postgres";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AuthConfig } from "./config.js";
import { HttpError, createCtx, type Ctx } from "./ctx.js";
import type { SigningKeys } from "./keys.js";
import { coreRoutes } from "./routes/core.js";
import { directoryRoutes } from "./routes/directory.js";
import { adminRoutes } from "./routes/admin.js";
import { oauthRoutes } from "./routes/oauth.js";
import { keyRoutes } from "./routes/keys.js";
import { mfaRoutes } from "./routes/mfa.js";
import { passkeyRoutes } from "./routes/passkeys.js";
import { samlRoutes } from "./routes/saml.js";
import { scimRoutes } from "./routes/scim.js";
import { ssoRoutes } from "./routes/sso.js";
import { createSecrets } from "./secrets.js";

export { REFRESH_COOKIE } from "./ctx.js";

export interface AppDeps {
  pool: Pool;
  config: AuthConfig;
  keys: SigningKeys;
  /** Per-minute cap on credential endpoints, per IP. */
  rateLimitMax?: number;
}

type RouteModule = (ctx: Ctx) => (r: FastifyInstance) => Promise<void>;

/** Route modules, each registered at `/...` and `/api/...` so proxies can forward /api/v1/* untouched. */
const modules: RouteModule[] = [coreRoutes, mfaRoutes, passkeyRoutes, keyRoutes, adminRoutes, directoryRoutes, scimRoutes, ssoRoutes, samlRoutes, oauthRoutes];

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { pool, config, keys } = deps;
  const app = Fastify({ logger: config.nodeEnv === "test" ? false : { level: "info" }, trustProxy: true });

  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err: Error & { validation?: string[]; statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, ...err.extra });
    if (err.validation) return reply.code(400).send({ error: "invalid_request", issues: err.validation });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  const ctx = createCtx({
    pool,
    db: drizzle(pool),
    config,
    keys,
    secrets: createSecrets(config.encKeyB64, config.pepper),
    limit: { rateLimit: { max: deps.rateLimitMax ?? 10, timeWindow: "1 minute" } },
  });

  for (const mod of modules) {
    const routes = mod(ctx);
    await app.register(routes);
    await app.register(routes, { prefix: "/api" });
  }
  return app;
}
