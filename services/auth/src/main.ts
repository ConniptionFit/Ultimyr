import { migrate } from "@ultimyr/db";
import { createPool } from "@ultimyr/db";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadAuthConfig } from "./config.js";
import { loadSigningKeys } from "./keys.js";

const config = loadAuthConfig();
const pool = createPool();
const keys = await loadSigningKeys(config.jwtPrivateKeyPem);

if (process.env.AUTH_AUTO_MIGRATE === "true") {
  const dir = process.env.AUTH_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../migrations");
  await migrate(pool, { service: "auth", dir, log: (m) => console.log(m) });
}

const app = await buildApp({ pool, config, keys });
if (!config.jwtPrivateKeyPem) app.log.warn("No JWT key configured: using an ephemeral dev key. Tokens will not survive a restart.");

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: config.host });
