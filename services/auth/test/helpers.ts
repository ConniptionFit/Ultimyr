import { resolve } from "node:path";
import { migrate } from "@ultimyr/db";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { loadAuthConfig } from "../src/config.js";
import { loadSigningKeys, type SigningKeys } from "../src/keys.js";

export const testDbUrl = process.env.TEST_DATABASE_URL;

export interface Harness {
  pool: pg.Pool;
  keys: SigningKeys;
  app: FastifyInstance;
  boot(env?: NodeJS.ProcessEnv): Promise<FastifyInstance>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const pool = new pg.Pool({ connectionString: testDbUrl });
  const keys = await loadSigningKeys();
  const h: Harness = {
    pool,
    keys,
    app: undefined as unknown as FastifyInstance,
    async boot(env = {}) {
      if (h.app) await h.app.close();
      h.app = await buildApp({
        pool,
        keys,
        config: loadAuthConfig({ NODE_ENV: "test", ULTIMYR_PUBLIC_URL: "http://localhost:3000", ...env }),
        rateLimitMax: 1000,
      });
      return h.app;
    },
    async reset() {
      await pool.query("DROP SCHEMA IF EXISTS auth CASCADE; DROP TABLE IF EXISTS public.ultimyr_migrations");
      await migrate(pool, { service: "auth", dir: resolve(import.meta.dirname, "../migrations") });
    },
    async close() {
      await h.app?.close();
      await pool.end();
    },
  };
  return h;
}

export const PASSWORD = "correct horse battery";

export async function register(app: FastifyInstance, email: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: PASSWORD, displayName: "Test User", ...extra },
  });
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
export const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) =>
  res.cookies.find((c) => c.name === "ultimyr_rt")?.value;
