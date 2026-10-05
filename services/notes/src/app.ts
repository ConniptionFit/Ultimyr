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
  /** Null when there is no master key: notes are switched off and every route answers 503. */
  sealer: Sealer | null;
  /** The Fast Note Sync address from the environment. When set it wins over the one an administrator saves in the web app. */
  envUrl: string | null;
  makeFns: (url: string) => Fns;
  /** Is a Fast Note Sync server answering at this address? Used when an administrator saves one. */
  probe: (url: string) => Promise<boolean>;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const svc = await createService({ name: "notes", pool: deps.pool, keySource: deps.keySource, logger: deps.logger });
  const ctx = createCtx({ svc, pool: deps.pool, content: deps.content, sealer: deps.sealer, envUrl: deps.envUrl, makeFns: deps.makeFns });
  await svc.mount(noteRoutes(ctx, deps.probe));
  return svc.app;
}
