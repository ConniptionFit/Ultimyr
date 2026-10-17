import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type pg from "pg";
import { migrate } from "./migrate.js";

/** Services that own a schema, in the order their migrations run (service name, folder under services/). */
export const MIGRATION_SERVICES: [service: string, folder: string][] = [
  ["auth", "auth"],
  ["content", "content"],
  ["quiz", "quiz"],
  ["ai", "ai-gateway"],
  ["notes", "notes"],
];

export interface MigrateAllOptions {
  /** Repository (or image) root that holds `services/<folder>/migrations`. */
  root: string;
  log?: (msg: string) => void;
}

/** Applies every service's migrations in order. Each service keeps its own directory and Postgres schema. */
export async function migrateAll(pool: pg.Pool, opts: MigrateAllOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  for (const [service, folder] of MIGRATION_SERVICES) {
    const dir = resolve(opts.root, `services/${folder}/migrations`);
    if (!existsSync(dir)) continue;
    const applied = await migrate(pool, { service, dir, log });
    log(`${service}: ${applied.length} migration(s) applied`);
  }
}

/** Waits for the database to accept connections (it may still be starting), and explains the usual causes if it never does. */
export async function waitForDatabase(pool: pg.Pool, opts: { attempts?: number; delayMs?: number; log?: (msg: string) => void } = {}): Promise<void> {
  const attempts = opts.attempts ?? 30;
  const log = opts.log ?? ((m: string) => console.error(m));
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      const hint =
        code === "ENOTFOUND" || code === "ECONNREFUSED"
          ? "The database host cannot be reached from this container. Check PG_HOST / DATABASE_URL in .env, and that the api container is on the same Docker network as your Postgres (DB_NETWORK in .env)."
          : code === "28P01" || code === "28000"
            ? "The database refused the login. Check PG_USER and secrets/pg_password."
            : code === "3D000"
              ? "That database does not exist yet. Create it once with deploy/postgres/setup.sql."
              : "Check the database settings in .env.";
      log(`Database not ready (attempt ${attempt}/${attempts}): ${e instanceof Error ? e.message : String(e)}`);
      if (attempt >= attempts) throw new Error(`Giving up. ${hint}`);
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 2000));
    }
  }
}
