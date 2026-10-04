import { resolve } from "node:path";
import { migrate } from "@ultimyr/db";
import { createTestIssuer } from "@ultimyr/service-kit/testing";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "../src/app.js";
import type { AccessChecker, ItemAccess } from "../src/access.js";

export const testDbUrl = process.env.TEST_DATABASE_URL;
export const uuid = () => crypto.randomUUID();

export interface Harness {
  pool: pg.Pool;
  app: FastifyInstance;
  issuer: ReturnType<typeof createTestIssuer>;
  /** Stub of the content service's answer: `${userId}:${itemId}` -> access. */
  access: Map<string, ItemAccess>;
  /** Move the service clock. */
  clock: { now: Date };
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const pool = new pg.Pool({ connectionString: testDbUrl });
  await pool.query("DROP SCHEMA IF EXISTS quiz CASCADE");
  await pool.query("DELETE FROM public.ultimyr_migrations WHERE service = 'quiz'").catch(() => {});
  await migrate(pool, { service: "quiz", dir: resolve(import.meta.dirname, "../migrations") });
  const issuer = createTestIssuer();
  const access = new Map<string, ItemAccess>();
  const clock = { now: new Date("2026-10-04T12:00:00Z") };
  const checker: AccessChecker = {
    async item(bearer, itemId) {
      const sub = JSON.parse(Buffer.from(bearer.split(".")[1]!, "base64url").toString()).sub as string;
      return access.get(`${sub}:${itemId}`) ?? null;
    },
  };
  const app = await buildApp({ pool, keySource: issuer.publicKey, access: checker, now: () => clock.now });
  return {
    pool,
    app,
    issuer,
    access,
    clock,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
