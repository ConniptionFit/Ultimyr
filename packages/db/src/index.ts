import pg from "pg";
import { loadDatabaseConfig } from "@ultimyr/config";

export { migrate } from "./migrate.js";

export function createPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const cfg = loadDatabaseConfig(env);
  return new pg.Pool({ connectionString: cfg.connectionString, ssl: cfg.ssl, max: 10 });
}

export type { Pool } from "pg";
