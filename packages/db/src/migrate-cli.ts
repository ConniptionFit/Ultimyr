import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPool, migrate } from "./index.js";

/**
 * Usage: migrate-cli [service=dir ...]
 * Defaults to every service shipped in this repository, in dependency order.
 * Each service owns its own migrations directory and Postgres schema.
 */
/** Services that own a schema, in the order their migrations run. */
const SERVICES: [service: string, dir: string][] = [["auth", "auth"], ["content", "content"], ["quiz", "quiz"], ["ai", "ai-gateway"], ["notes", "notes"]];
const root = process.env.ULTIMYR_ROOT ?? resolve(import.meta.dirname, "../../..");
const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((a) => {
      const [service, dir] = a.split("=");
      if (!service || !dir) throw new Error(`Bad target "${a}", expected service=dir`);
      return { service, dir: resolve(dir) };
    })
  : SERVICES.map(([service, folder]) => ({ service, dir: resolve(root, `services/${folder}/migrations`) })).filter((t) => existsSync(t.dir));

const pool = createPool();
/** Waits for the database to accept connections (it may still be starting), and explains the usual causes if it never does. */
async function waitForDatabase() {
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("select 1");
      return;
    } catch (e) {
      const code = (e as { code?: string }).code;
      const hint =
        code === "ENOTFOUND" || code === "ECONNREFUSED"
          ? "The database host cannot be reached from this container. Check PG_HOST / DATABASE_URL in .env. If you use the bundled database, start it with: docker compose --profile bundled-db up -d"
          : code === "28P01" || code === "28000"
            ? "The database refused the login. Check PG_USER and secrets/pg_password."
            : "Check the database settings in .env.";
      console.error(`Database not ready (attempt ${attempt}/30): ${e instanceof Error ? e.message : String(e)}`);
      if (attempt >= 30) {
        console.error(`Giving up. ${hint}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
try {
  await waitForDatabase();
  for (const t of targets) {
    const applied = await migrate(pool, { ...t, log: (m) => console.log(m) });
    console.log(`${t.service}: ${applied.length} migration(s) applied`);
  }
} finally {
  await pool.end();
}
