import { resolve } from "node:path";
import { migrate } from "@ultimyr/db";
import { createTestIssuer } from "@ultimyr/service-kit/testing";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "../src/app.js";
import type { GroupResolver } from "../src/access.js";

export const testDbUrl = process.env.TEST_DATABASE_URL;

export interface Harness {
  pool: pg.Pool;
  app: FastifyInstance;
  issuer: ReturnType<typeof createTestIssuer>;
  /** user id -> group ids, consulted by the stub group resolver. */
  groups: Map<string, string[]>;
  /** Move the service clock (used by spaced repetition). */
  clock: { now: Date };
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const pool = new pg.Pool({ connectionString: testDbUrl });
  await pool.query("DROP SCHEMA IF EXISTS content CASCADE; DELETE FROM public.ultimyr_migrations WHERE service = 'content'").catch(async () => {
    await pool.query("DROP SCHEMA IF EXISTS content CASCADE");
  });
  await migrate(pool, { service: "content", dir: resolve(import.meta.dirname, "../migrations") });
  const issuer = createTestIssuer();
  const groups = new Map<string, string[]>();
  const resolver: GroupResolver = { groupsFor: async (p) => groups.get(p.userId) ?? [] };
  const clock = { now: new Date() };
  const app = await buildApp({ pool, keySource: issuer.publicKey, groups: resolver, now: () => clock.now });
  return {
    pool,
    app,
    issuer,
    groups,
    clock,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

export const uuid = () => crypto.randomUUID();

/** A tiny valid RGBA PNG (16x16, fully transparent) with extra text chunks that must be stripped. */
export async function makePng(opts: { colorType?: number; size?: number; withText?: boolean } = {}): Promise<Buffer> {
  const { deflateSync } = await import("node:zlib");
  const { crc32 } = await import("node:zlib");
  const size = opts.size ?? 16;
  const colorType = opts.colorType ?? 6;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * channels)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(opts.withText ? [chunk("tEXt", Buffer.from("Comment\0secret-location-data"))] : []),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
