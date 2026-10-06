import pg from "pg";
import { loadDatabaseConfig } from "@ultimyr/config";

export { migrate } from "./migrate.js";

/** Reads a whole number of milliseconds from the environment, falling back when it is missing or not a number. */
function ms(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(n) && n >= 0 ? n : fallback;
}

/**
 * A connection pool that survives a database restart and does not hang forever.
 * - An idle connection that dies emits "error"; without a listener Node would crash the service, so it is logged and the pool opens a new one.
 * - Waiting for a free connection gives up after 10 seconds (PG_CONNECT_TIMEOUT_MS) instead of queueing a request indefinitely.
 * - A query that runs longer than 30 seconds (PG_STATEMENT_TIMEOUT_MS, 0 turns it off) is cancelled, so one bad query cannot hold a connection for ever.
 */
export function createPool(env: NodeJS.ProcessEnv = process.env): pg.Pool {
  const cfg = loadDatabaseConfig(env);
  const pool = new pg.Pool({
    connectionString: cfg.connectionString,
    ssl: cfg.ssl,
    max: 10,
    keepAlive: true,
    connectionTimeoutMillis: ms(env.PG_CONNECT_TIMEOUT_MS, 10_000),
    statement_timeout: ms(env.PG_STATEMENT_TIMEOUT_MS, 30_000),
  });
  pool.on("error", (e) => console.error(JSON.stringify({ level: "error", msg: "idle database connection failed, a new one will be opened", err: e.message })));
  return pool;
}

export type { Pool } from "pg";
