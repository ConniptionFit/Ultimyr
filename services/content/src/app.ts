import { createService, type Pool } from "@ultimyr/service-kit";
import type { KeySource } from "@ultimyr/authz";
import type { FastifyInstance } from "fastify";
import type { GroupResolver } from "./access.js";
import { createCtx } from "./ctx.js";
import { archiveRoutes } from "./routes/archives.js";
import { grantRoutes } from "./routes/grants.js";
import { ioRoutes } from "./routes/io.js";
import { itemRoutes } from "./routes/items.js";
import { searchRoutes } from "./routes/search.js";
import { studyRoutes } from "./routes/study.js";

export interface AppDeps {
  pool: Pool;
  keySource: KeySource;
  groups: GroupResolver;
  now?: () => Date;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const svc = await createService({ name: "content", pool: deps.pool, keySource: deps.keySource, logger: deps.logger });
  const ctx = createCtx(svc, deps.pool, deps.groups, deps.now);
  for (const mod of [archiveRoutes, itemRoutes, grantRoutes, searchRoutes, ioRoutes, studyRoutes]) await svc.mount(mod(ctx));
  return svc.app;
}

/** Permanently remove anything deleted more than 30 days ago. */
export async function purgeDeleted(pool: Pool, days = 30): Promise<number> {
  const a = await pool.query("DELETE FROM content.master_items WHERE deleted_at < now() - ($1 || ' days')::interval", [days]);
  const b = await pool.query("DELETE FROM content.sub_items WHERE deleted_at < now() - ($1 || ' days')::interval", [days]);
  await pool.query("DELETE FROM content.assets a WHERE kind = 'icon' AND NOT EXISTS (SELECT 1 FROM content.master_items m WHERE m.icon_asset_id = a.id) AND created_at < now() - interval '1 day'");
  return (a.rowCount ?? 0) + (b.rowCount ?? 0);
}
