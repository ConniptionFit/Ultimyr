import { hasScope, verifyAccessToken, type KeySource, type Principal } from "@ultimyr/authz";
import { randomBytes } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyPluginAsync, type FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

export type { Principal } from "@ultimyr/authz";
export type { Pool } from "pg";

/** An error that maps straight to an HTTP response: `{ error: code, ...extra }`. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** Validate untrusted input with Zod. Failures become a 400 listing each problem. */
/** SQLSTATE classes for data the database cannot store: 22021 bad encoding or NUL, 22P05 untranslatable character, 22P02 malformed text, 22001 too long. */
export const BAD_DATA_CODES = new Set(["22021", "22P05", "22P02", "22001"]);

/** True when Postgres refused the data itself. Drizzle wraps the driver error, so the cause chain is checked too. */
export function isBadDataError(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (typeof e.code === "string" && BAD_DATA_CODES.has(e.code)) return true;
  }
  return false;
}

const zoneKnown = new Map<string, boolean>();

/**
 * The caller's IANA time zone (for "today" in their own calendar), or "UTC" when it is missing or not one Postgres knows.
 * Checked against pg_timezone_names once per name and remembered.
 */
export async function resolveZone(pool: Pool, tz: unknown): Promise<string> {
  if (typeof tz !== "string" || tz === "UTC" || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/.test(tz) || tz.length > 64) return "UTC";
  let ok = zoneKnown.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      ok = (await pool.query("SELECT 1 FROM pg_timezone_names WHERE name = $1", [tz])).rowCount === 1;
    } catch {
      ok = false;
    }
    if (zoneKnown.size < 500) zoneKnown.set(tz, ok);
  }
  return ok ? tz : "UTC";
}

/** YYYY-MM-DD of an instant on a zone's calendar. */
export function zoneDay(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new HttpError(400, "invalid_request", {
      issues: r.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)),
    });
  }
  return r.data;
}

/** UUIDv7: time-ordered ids keep btree indexes tidy. */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const uuidParam = z.uuid();

/** Read a path or query value that must be a UUID, or fail with 404 (unknown ids never reveal anything). */
export function idParam(req: FastifyRequest, name = "id"): string {
  const v = (req.params as Record<string, string>)[name];
  const r = uuidParam.safeParse(v);
  if (!r.success) throw new HttpError(404, "not_found");
  return r.data;
}

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export interface ServiceOptions {
  /** Service name, used in logs and the health response. */
  name: string;
  pool: Pool;
  /** Where access-token verification keys come from: a JWKS fetcher in production, a local key in tests. */
  keySource: KeySource;
  /** Request body cap in bytes. Default 1 MiB. */
  bodyLimit?: number;
  /** Per-minute cap for routes that opt in with `config: app.limit`. Default 60. */
  rateLimitMax?: number;
  logger?: boolean;
}

export interface Service {
  app: FastifyInstance;
  /** Verify the bearer token. Throws 401. Tokens are short lived and verified statelessly. */
  authenticate(req: FastifyRequest): Promise<Principal>;
  /** Authenticate and require the token to carry `scope` (interactive sessions carry all). */
  authorize(req: FastifyRequest, scope: string): Promise<Principal>;
  /** Route config that applies the per-minute rate limit. */
  limit: { rateLimit: { max: number; timeWindow: string } };
  /** Register routes at `/...` and `/api/...` so proxies can forward `/api/v1/*` untouched. */
  mount(plugin: FastifyPluginAsync): Promise<void>;
}

export async function createService(opts: ServiceOptions): Promise<Service> {
  const app = Fastify({
    logger: opts.logger ?? false ? { level: "info" } : false,
    trustProxy: true,
    bodyLimit: opts.bodyLimit ?? 1024 * 1024,
  });
  await app.register(rateLimit, { global: false });

  // Baseline response headers for every API: no sniffing, no framing, and private data is never cached unless a route says so.
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, ...err.extra });
    if (err.validation) return reply.code(400).send({ error: "invalid_request" });
    // Postgres refusing the data itself (a NUL character, a malformed value, text too long) is the caller's mistake, not ours.
    if (isBadDataError(err)) return reply.code(400).send({ error: "invalid_request" });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    // `ref` is the request id in the log line, so a person can quote it and an administrator can find the cause.
    app.log.error({ err, ref: req.id }, "unhandled error");
    return reply.code(500).send({ error: "internal_error", ref: req.id });
  });

  app.get("/healthz", async () => ({ status: "ok", service: opts.name }));
  app.get("/readyz", async (_req, reply) => {
    try {
      await opts.pool.query("SELECT 1");
      return { status: "ready", service: opts.name };
    } catch {
      return reply.code(503).send({ status: "unavailable" });
    }
  });

  const authenticate: Service["authenticate"] = async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new HttpError(401, "unauthenticated");
    try {
      return await verifyAccessToken(header.slice(7), opts.keySource);
    } catch {
      throw new HttpError(401, "unauthenticated");
    }
  };

  return {
    app,
    authenticate,
    async authorize(req, scope) {
      const p = await authenticate(req);
      if (!hasScope(p, scope)) throw new HttpError(403, "insufficient_scope", { scope });
      return p;
    },
    limit: { rateLimit: { max: opts.rateLimitMax ?? 60, timeWindow: "1 minute" } },
    async mount(plugin) {
      await app.register(plugin);
      await app.register(plugin, { prefix: "/api" });
    },
  };
}

/** Run `fn` inside a transaction on a dedicated client. */
export async function tx<T>(pool: Pool, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Standard process lifecycle for a service entrypoint. */
export function onShutdown(fn: () => Promise<void>): void {
  const run = async () => {
    await fn().catch(() => undefined);
    process.exit(0);
  };
  process.once("SIGTERM", run);
  process.once("SIGINT", run);
}
