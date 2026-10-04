import { remoteKeySource } from "@ultimyr/authz";
import { createPool, migrate } from "@ultimyr/db";
import { onShutdown } from "@ultimyr/service-kit";
import { resolve } from "node:path";
import { buildApp, purgeDeleted } from "./app.js";
import { httpGroupResolver } from "./access.js";
import { loadContentConfig } from "./config.js";

const config = loadContentConfig();
const pool = createPool();

if (process.env.CONTENT_AUTO_MIGRATE === "true") {
  const dir = process.env.CONTENT_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../migrations");
  await migrate(pool, { service: "content", dir, log: (m) => console.log(m) });
}

const app = await buildApp({
  pool,
  keySource: remoteKeySource(`${config.authUrl}/.well-known/jwks.json`),
  groups: httpGroupResolver(config.authUrl),
  logger: config.nodeEnv !== "test",
});

const purge = setInterval(() => purgeDeleted(pool).catch((e) => app.log.warn({ err: String(e) }, "purge failed")), 6 * 60 * 60 * 1000);
purge.unref();
onShutdown(async () => {
  clearInterval(purge);
  await app.close();
  await pool.end();
});

await app.listen({ port: config.port, host: config.host });
