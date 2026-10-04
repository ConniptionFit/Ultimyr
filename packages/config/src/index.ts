import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Read a secret from `NAME` or, if absent, from the file at `NAME_FILE`
 * (Docker secrets convention).
 */
export function readSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = env[name];
  if (direct !== undefined && direct !== "") return direct;
  const file = env[`${name}_FILE`];
  if (file) return readFileSync(file, "utf8").trim();
  return undefined;
}

export interface DatabaseConfig {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean };
}

const sslModes = ["disable", "require", "verify-full"] as const;

/**
 * Resolve the Postgres connection from either `DATABASE_URL` or the discrete
 * `PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE` variables, so admins can
 * point Ultimyr at an existing external server.
 */
export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const mode = z.enum(sslModes).default("disable").parse(env.PG_SSLMODE || undefined);
  const ssl = mode === "disable" ? false : { rejectUnauthorized: mode === "verify-full" };

  const url = readSecret("DATABASE_URL", env);
  if (url) return { connectionString: url, ssl };

  const host = env.PG_HOST;
  const user = env.PG_USER;
  const database = env.PG_DATABASE;
  if (!host || !user || !database) {
    throw new Error("Database not configured: set DATABASE_URL, or PG_HOST, PG_USER and PG_DATABASE (plus PG_PASSWORD).");
  }
  const password = readSecret("PG_PASSWORD", env) ?? "";
  const port = env.PG_PORT || "5432";
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return {
    connectionString: `postgres://${auth}@${host}:${port}/${encodeURIComponent(database)}`,
    ssl,
  };
}

/** Parse env with a schema and fail fast with a readable message. */
export function parseEnv<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

export const booleanFromEnv = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
