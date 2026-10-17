import { createPool, migrateAll, waitForDatabase } from "@ultimyr/db";
import { resolve } from "node:path";
import { SERVICES, serviceEnv } from "./services.js";
import { healthServer, Supervisor } from "./supervisor.js";

/** Repository (or image) root: holds services/<folder>/dist/main.js and services/<folder>/migrations. */
const root = process.env.ULTIMYR_ROOT ?? resolve(import.meta.dirname, "../../..");
const healthPort = Number(process.env.API_HEALTH_PORT ?? 4000);

// 1. Migrations, once, before anything serves traffic. Long statements (an index build) get no timeout.
const pool = createPool({ ...process.env, PG_STATEMENT_TIMEOUT_MS: "0" });
try {
  await waitForDatabase(pool);
  await migrateAll(pool, { root, log: (m) => console.log(`[migrate] ${m}`) });
} catch (e) {
  console.error(`[migrate] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
} finally {
  await pool.end();
}

// 2. Each service as its own process, restarted on its own if it ever exits.
const sup = new Supervisor(
  SERVICES.map((s) => ({
    name: s.name,
    entry: resolve(root, `services/${s.folder}/dist/main.js`),
    port: s.port,
    group: s.group,
    env: serviceEnv(s, process.env),
  })),
  { log: (m) => console.log(m) },
);
const health = await healthServer(sup, healthPort);

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  health.close();
  await sup.stop();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await sup.start();
console.log("[api] all services started");
