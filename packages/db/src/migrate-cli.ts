import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPool, migrate } from "./index.js";

/**
 * Usage: migrate-cli [service=dir ...]
 * Defaults to every service shipped in this repository, in dependency order.
 * Each service owns its own migrations directory and Postgres schema.
 */
/** Services that own a schema, in the order their migrations run. */
const SERVICES: [service: string, dir: string][] = [["auth", "auth"], ["content", "content"], ["quiz", "quiz"], ["ai", "ai-gateway"]];
const root = process.env.ULTIMYR_ROOT ?? resolve(import.meta.dirname, "../../..");
const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((a) => {
      const [service, dir] = a.split("=");
      if (!service || !dir) throw new Error(`Bad target "${a}", expected service=dir`);
      return { service, dir: resolve(dir) };
    })
  : SERVICES.map(([service, folder]) => ({ service, dir: resolve(root, `services/${folder}/migrations`) })).filter((t) => existsSync(t.dir));

const pool = createPool();
try {
  for (const t of targets) {
    const applied = await migrate(pool, { ...t, log: (m) => console.log(m) });
    console.log(`${t.service}: ${applied.length} migration(s) applied`);
  }
} finally {
  await pool.end();
}
