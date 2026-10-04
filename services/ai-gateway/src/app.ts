import type { KeySource } from "@ultimyr/authz";
import { createService, type Pool } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import type { AiConfig } from "./config.js";
import { createCtx, type Upstream } from "./ctx.js";
import { JobRunner } from "./jobs.js";
import { agentRoutes } from "./routes/agent.js";
import { credentialRoutes } from "./routes/credentials.js";
import { generateRoutes } from "./routes/generate.js";
import { KeyRing, Vault } from "./vault.js";

export interface AppDeps {
  pool: Pool;
  keySource: KeySource;
  cfg: AiConfig;
  /** Injected in tests: the HTTP client used for providers and the upstream services. */
  fetch?: typeof fetch;
  upstream?: Upstream;
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; runner: JobRunner; vaultEnabled: boolean }> {
  const svc = await createService({ name: "ai-gateway", pool: deps.pool, keySource: deps.keySource, logger: deps.logger });
  // No master key, no vault. There is deliberately no fallback to storing secrets in the clear.
  const ring = KeyRing.fromConfig(deps.cfg.vaultKek, deps.cfg.vaultKekVersion, deps.cfg.vaultKekPrevious);
  const vault = ring ? new Vault(deps.pool, ring) : null;
  const ctx = createCtx(svc, deps.pool, deps.cfg, vault, { fetch: deps.fetch, upstream: deps.upstream, now: deps.now });
  const runner = new JobRunner(ctx);
  await runner.recover();
  await svc.mount(credentialRoutes(ctx));
  await svc.mount(generateRoutes(ctx, runner));
  await svc.mount(agentRoutes(ctx));
  return { app: svc.app, runner, vaultEnabled: vault !== null };
}
