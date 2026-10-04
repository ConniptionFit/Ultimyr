import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";

export interface MigrateOptions {
  /** Logical owner of the migrations (service name). */
  service: string;
  /** Directory of ordered `*.sql` files. */
  dir: string;
  log?: (msg: string) => void;
}

/**
 * Minimal forward-only SQL migration runner. Each file runs in its own
 * transaction and is recorded in `public.ultimyr_migrations`. A Postgres
 * advisory lock keeps concurrent migrators (several replicas) from racing.
 */
export async function migrate(pool: pg.Pool, opts: MigrateOptions): Promise<string[]> {
  const log = opts.log ?? (() => {});
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('ultimyr_migrate'))");
    await client.query(`CREATE TABLE IF NOT EXISTS public.ultimyr_migrations (
      service text NOT NULL,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (service, name)
    )`);

    const files = readdirSync(opts.dir).filter((f) => f.endsWith(".sql")).sort();
    const done = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM public.ultimyr_migrations WHERE service = $1",
      [opts.service],
    );
    const doneMap = new Map(done.rows.map((r) => [r.name, r.checksum]));

    for (const file of files) {
      const sql = readFileSync(join(opts.dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prior = doneMap.get(file);
      if (prior) {
        if (prior !== checksum) throw new Error(`Migration ${opts.service}/${file} was modified after being applied.`);
        continue;
      }
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO public.ultimyr_migrations (service, name, checksum) VALUES ($1, $2, $3)", [
          opts.service,
          file,
          checksum,
        ]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${opts.service}/${file} failed: ${(err as Error).message}`);
      }
      log(`applied ${opts.service}/${file}`);
      applied.push(file);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('ultimyr_migrate'))").catch(() => {});
    client.release();
  }
  return applied;
}
