import type { KeySource } from "@ultimyr/authz";
import { createService, type Pool } from "@ultimyr/service-kit";
import type { FastifyInstance } from "fastify";
import type { ContentReader } from "./content.js";
import { createCtx } from "./ctx.js";
import type { Fns } from "./fns.js";
import { noteRoutes } from "./routes/notes.js";
import type { Sealer } from "./seal.js";

export interface AppDeps {
  pool: Pool;
  keySource: KeySource;
  content: ContentReader;
  /** Null when FNS_URL is unset: notes are switched off and every route answers 503. */
  fns: Fns | null;
  sealer: Sealer | null;
  fnsHost?: string | null;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const svc = await createService({ name: "notes", pool: deps.pool, keySource: deps.keySource, logger: deps.logger });
  const ctx = createCtx(svc, deps.pool, deps.content, deps.fns, deps.sealer, deps.fnsHost ?? null);
  await svc.mount(noteRoutes(ctx));
  return svc.app;
}
