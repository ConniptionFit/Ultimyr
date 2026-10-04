import { resolve } from "node:path";
import { createPool, migrate } from "./index.js";

/**
 * Usage: migrate-cli [service=dir ...]
 * Defaults to the auth service shipped in this repository. Each service owns
 * its own migrations directory and Postgres schema.
 */
const root = process.env.ULTIMYR_ROOT ?? resolve(import.meta.dirname, "../../..");
const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((a) => {
      const [service, dir] = a.split("=");
      if (!service || !dir) throw new Error(`Bad target "${a}", expected service=dir`);
      return { service, dir: resolve(dir) };
    })
  : [{ service: "auth", dir: resolve(root, "services/auth/migrations") }];

const pool = createPool();
try {
  for (const t of targets) {
    const applied = await migrate(pool, { ...t, log: (m) => console.log(m) });
    console.log(`${t.service}: ${applied.length} migration(s) applied`);
  }
} finally {
  await pool.end();
}
