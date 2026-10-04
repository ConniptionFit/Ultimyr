import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { migrate } from "@ultimyr/db";
import { createTestIssuer } from "@ultimyr/service-kit/testing";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "../src/app.js";
import type { ContentReader } from "../src/content.js";
import { FnsError, type Fns } from "../src/fns.js";
import type { PlanInput } from "../src/plan.js";
import { Sealer } from "../src/seal.js";

export const testDbUrl = process.env.TEST_DATABASE_URL;
export const uuid = () => crypto.randomUUID();

/** An in-memory Fast Note Sync: one vault, a token, notes with content hashes. */
export function fakeFns() {
  const notes = new Map<string, { content: string; n: number }>();
  const state = { token: "good-token-123", vaults: ["Study"], down: false, patches: [] as { path: string; updates: Record<string, unknown> }[] };
  const hash = (path: string) => `h${notes.get(path)!.n}`;
  const check = (token: string) => {
    if (state.down) throw new FnsError(503, "fns_unreachable");
    if (token !== state.token) throw new FnsError(401, "fns_token_rejected");
  };
  const fns: Fns = {
    async vaults(t) {
      check(t);
      return state.vaults;
    },
    async getNote(t, _v, path) {
      check(t);
      return notes.has(path) ? { path, content: notes.get(path)!.content, hash: hash(path) } : null;
    },
    async createNote(t, _v, path, content) {
      check(t);
      if (notes.has(path)) throw new FnsError(409, "note exists");
      notes.set(path, { content, n: 1 });
      return hash(path);
    },
    async saveNote(t, _v, path, content, baseHash) {
      check(t);
      const cur = notes.get(path);
      if (!cur || hash(path) !== baseHash) throw new FnsError(409, "hash mismatch");
      notes.set(path, { content, n: cur.n + 1 });
      return hash(path);
    },
    async patchFrontmatter(t, _v, path, updates) {
      check(t);
      if (!notes.has(path)) throw new FnsError(409, "not found");
      state.patches.push({ path, updates });
    },
  };
  return { fns, notes, state };
}

export interface Harness {
  pool: pg.Pool;
  app: FastifyInstance;
  issuer: ReturnType<typeof createTestIssuer>;
  fake: ReturnType<typeof fakeFns>;
  /** What the content service says: `${userId}:${archiveId}` -> plan. */
  plans: Map<string, PlanInput>;
  close(): Promise<void>;
}

export async function createHarness(opts: { enabled?: boolean } = {}): Promise<Harness> {
  const pool = new pg.Pool({ connectionString: testDbUrl });
  await pool.query("DROP SCHEMA IF EXISTS notes CASCADE");
  await pool.query("DELETE FROM public.ultimyr_migrations WHERE service = 'notes'").catch(() => {});
  await migrate(pool, { service: "notes", dir: resolve(import.meta.dirname, "../migrations") });
  const issuer = createTestIssuer();
  const fake = fakeFns();
  const plans = new Map<string, PlanInput>();
  const content: ContentReader = {
    async plan(bearer, archiveId) {
      const sub = JSON.parse(Buffer.from(bearer.split(".")[1]!, "base64url").toString()).sub as string;
      return plans.get(`${sub}:${archiveId}`) ?? null;
    },
  };
  const enabled = opts.enabled ?? true;
  const app = await buildApp({
    pool,
    keySource: issuer.publicKey,
    content,
    fns: enabled ? fake.fns : null,
    sealer: enabled ? new Sealer(1, new Map([[1, randomBytes(32)]])) : null,
    fnsHost: "fns.test",
  });
  return {
    pool,
    app,
    issuer,
    fake,
    plans,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
