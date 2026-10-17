import { resolve } from "node:path";
import { createPool, migrate, migrateAll, waitForDatabase } from "./index.js";

/**
 * Usage: migrate-cli [service=dir ...]
 * Defaults to every service shipped in this repository, in dependency order.
 * Each service owns its own migrations directory and Postgres schema.
 * (The api container runs the same migrations itself at start; this is for `pnpm migrate` during development.)
 */
const root = process.env.ULTIMYR_ROOT ?? resolve(import.meta.dirname, "../../..");
const targets = process.argv.slice(2).map((a) => {
  const [service, dir] = a.split("=");
  if (!service || !dir) throw new Error(`Bad target "${a}", expected service=dir`);
  return { service, dir: resolve(dir) };
});

// Migrations may legitimately run a long statement (an index build), so they get no statement timeout.
const pool = createPool({ ...process.env, PG_STATEMENT_TIMEOUT_MS: "0" });
try {
  await waitForDatabase(pool).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
  if (targets.length) {
    for (const t of targets) {
      const applied = await migrate(pool, { ...t, log: (m) => console.log(m) });
      console.log(`${t.service}: ${applied.length} migration(s) applied`);
    }
  } else {
    await migrateAll(pool, { root, log: (m) => console.log(m) });
  }
} finally {
  await pool.end();
}
