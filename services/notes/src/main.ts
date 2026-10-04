import { remoteKeySource } from "@ultimyr/authz";
import { createPool, migrate } from "@ultimyr/db";
import { onShutdown } from "@ultimyr/service-kit";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadNotesConfig } from "./config.js";
import { httpContentReader } from "./content.js";
import { httpFns } from "./fns.js";
import { Sealer } from "./seal.js";

const cfg = loadNotesConfig();
const pool = createPool();

if (process.env.NOTES_AUTO_MIGRATE === "true") {
  const dir = process.env.NOTES_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../migrations");
  await migrate(pool, { service: "notes", dir, log: (m) => console.log(m) });
}

let sealer: Sealer | null = null;
let keyProblem: string | null = null;
try {
  sealer = Sealer.fromConfig(cfg.kek, cfg.kekVersion, cfg.kekPrevious);
} catch (e) {
  // A bad key switches notes off instead of crash looping, so the rest of the stack is never held back by it.
  keyProblem = e instanceof Error ? e.message : String(e);
}
const enabled = !!cfg.fnsUrl && !!sealer;
const app = await buildApp({
  pool,
  keySource: remoteKeySource(`${cfg.authUrl}/.well-known/jwks.json`),
  content: httpContentReader(cfg.contentUrl),
  fns: enabled ? httpFns(cfg.fnsUrl!) : null,
  sealer,
  fnsHost: cfg.fnsUrl ? new URL(cfg.fnsUrl).host : null,
  logger: cfg.nodeEnv !== "test",
});
if (keyProblem) app.log.error(`Notes are off: the vault key is not usable (${keyProblem}).`);
else if (!enabled) app.log.warn("Notes are off: set FNS_URL and ULTIMYR_VAULT_KEK to connect Fast Note Sync.");

onShutdown(async () => {
  await app.close();
  await pool.end();
});

await app.listen({ port: cfg.port, host: cfg.host });
