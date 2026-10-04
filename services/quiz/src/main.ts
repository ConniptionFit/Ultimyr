import { remoteKeySource } from "@ultimyr/authz";
import { createPool, migrate } from "@ultimyr/db";
import { onShutdown } from "@ultimyr/service-kit";
import { resolve } from "node:path";
import { httpAccessChecker } from "./access.js";
import { buildApp } from "./app.js";
import { loadQuizConfig } from "./config.js";

const config = loadQuizConfig();
const pool = createPool();

if (process.env.QUIZ_AUTO_MIGRATE === "true") {
  const dir = process.env.QUIZ_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../migrations");
  await migrate(pool, { service: "quiz", dir, log: (m) => console.log(m) });
}

const app = await buildApp({
  pool,
  keySource: remoteKeySource(`${config.authUrl}/.well-known/jwks.json`),
  access: httpAccessChecker(config.contentUrl),
  logger: config.nodeEnv !== "test",
});

onShutdown(async () => {
  await app.close();
  await pool.end();
});

await app.listen({ port: config.port, host: config.host });
