import type { KeySource } from "@ultimyr/authz";
import { createService, type Pool } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import type { AccessChecker } from "./access.js";
import { createCtx } from "./ctx.js";
import { ensureOfficialProfiles } from "./profiles.js";
import { attemptRoutes } from "./routes/attempts.js";
import { profileRoutes } from "./routes/profiles.js";
import { progressRoutes } from "./routes/progress.js";
import { questionRoutes } from "./routes/questions.js";

export interface AppDeps {
  pool: Pool;
  keySource: KeySource;
  access: AccessChecker;
  /** Injected so tests can move time. */
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const svc = await createService({ name: "quiz", pool: deps.pool, keySource: deps.keySource, logger: deps.logger });
  const ctx = createCtx(svc, deps.pool, deps.access, deps.now ?? (() => new Date()));
  await ensureOfficialProfiles(deps.pool);
  for (const mod of [questionRoutes, profileRoutes, attemptRoutes, progressRoutes]) await svc.mount(mod(ctx));
  return svc.app;
}
