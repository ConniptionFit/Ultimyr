import { remoteKeySource } from "@ultimyr/authz";
import { createPool, migrate } from "@ultimyr/db";
import { onShutdown } from "@ultimyr/service-kit";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadAiConfig } from "./config.js";

const cfg = loadAiConfig();
const pool = createPool();

if (process.env.AI_AUTO_MIGRATE === "true") {
  const dir = process.env.AI_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../migrations");
  await migrate(pool, { service: "ai", dir, log: (m) => console.log(m) });
}

const { app, runner, vaultEnabled } = await buildApp({ pool, keySource: remoteKeySource(`${cfg.authUrl}/.well-known/jwks.json`), cfg, logger: cfg.nodeEnv !== "test" });
if (!vaultEnabled) app.log.warn("ULTIMYR_VAULT_KEK is not set: the AI vault is disabled and AI features will answer 503. Generate a key with: openssl rand -base64 32");

onShutdown(async () => {
  await app.close();
  await runner.idle();
  await pool.end();
});

await app.listen({ port: cfg.port, host: cfg.host });
