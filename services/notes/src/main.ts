import { remoteKeySource } from "@ultimyr/authz";
import { createPool, migrate } from "@ultimyr/db";
import { onShutdown } from "@ultimyr/service-kit";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadNotesConfig } from "./config.js";
import { httpContentReader } from "./content.js";
import { httpFns, probeFns } from "./fns.js";
import { Sealer } from "./seal.js";

const cfg = loadNotesConfig();
const pool = createPool();

// Apply this service's own migrations at start (they are idempotent and tracked), so notes never depend on the one-shot migrate job being up to date.
// An unreachable database is retried for a while and then logged, never a crash: the service stays up, answers "notes_db_unavailable" and migrates when asked again after a restart.
if (process.env.NOTES_AUTO_MIGRATE !== "false") {
  const dir = process.env.NOTES_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../migrations");
  for (let attempt = 1; ; attempt++) {
    try {
      await migrate(pool, { service: "notes", dir, log: (m) => console.log(m) });
      break;
    } catch (e) {
      const code = (e as { code?: string }).code;
      const hint = code === "ENOTFOUND" || code === "ECONNREFUSED" ? ` The database host is not reachable from this container. Check PG_HOST / DATABASE_URL in .env, and if you use the bundled database, run: docker compose --profile bundled-db up -d` : "";
      console.error(`Notes migration attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}.${hint}`);
      if (attempt >= 10) break;
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 10000)));
    }
  }
}

let sealer: Sealer | null = null;
let keyProblem: string | null = null;
try {
  sealer = Sealer.fromConfig(cfg.kek, cfg.kekVersion, cfg.kekPrevious);
} catch (e) {
  // A bad key switches notes off instead of crash looping, so the rest of the stack is never held back by it.
  keyProblem = e instanceof Error ? e.message : String(e);
}
const app = await buildApp({
  pool,
  keySource: remoteKeySource(`${cfg.authUrl}/.well-known/jwks.json`),
  content: httpContentReader(cfg.contentUrl),
  sealer,
  envUrl: cfg.fnsUrl ?? null,
  makeFns: (url) => httpFns(url),
  probe: (url) => probeFns(url),
  logger: cfg.nodeEnv !== "test",
});
if (keyProblem) app.log.error(`Notes are off: the vault key is not usable (${keyProblem}).`);
else if (!sealer) app.log.warn("Notes are off: ULTIMYR_VAULT_KEK is not set.");
else if (!cfg.fnsUrl) app.log.info("No FNS_URL set: an administrator can set the Fast Note Sync address in Admin panel > Notes.");

onShutdown(async () => {
  await app.close();
  await pool.end();
});

await app.listen({ port: cfg.port, host: cfg.host });
