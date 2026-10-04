import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { migrate } from "@ultimyr/db";
import { createTestIssuer } from "@ultimyr/service-kit/testing";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { loadAiConfig } from "../src/config.js";
import type { Upstream } from "../src/ctx.js";

export const testDbUrl = process.env.TEST_DATABASE_URL;
export const uuid = () => crypto.randomUUID();
export const newKek = () => randomBytes(32).toString("base64");

/** A fake model provider that speaks all three wire formats, records what it receives, and can be told to fail. */
export interface Stub {
  url: string;
  requests: { path: string; headers: Record<string, string | string[] | undefined>; body: any }[];
  /** Text every provider will stream back. */
  reply: string;
  /** When set, answer with this status instead of streaming. */
  fail: number | null;
  /** Keys starting with this prefix are rejected with 401. */
  badKeyPrefix: string;
  close(): Promise<void>;
}

export async function startStub(): Promise<Stub> {
  const stub: Stub = { url: "", requests: [], reply: "OK", fail: null, badKeyPrefix: "bad", close: async () => {} };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      stub.requests.push({ path: req.url ?? "", headers: req.headers, body });
      const key = String(req.headers["authorization"]?.toString().replace("Bearer ", "") ?? req.headers["x-api-key"] ?? req.headers["x-goog-api-key"] ?? "");
      if (key.startsWith(stub.badKeyPrefix)) return void res.writeHead(401).end('{"error":"nope, key was ' + key + '"}');
      if (stub.fail) return void res.writeHead(stub.fail).end('{"error":"boom"}');
      res.writeHead(200, { "content-type": "text/event-stream" });
      const parts = stub.reply.match(/[\s\S]{1,40}/g) ?? [""];
      const w = (s: string) => res.write(s);
      if (req.url?.startsWith("/v1/chat/completions")) {
        for (const p of parts) w(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
        w(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\ndata: [DONE]\n\n`);
      } else if (req.url?.startsWith("/v1/messages")) {
        w(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 11 } } })}\n\n`);
        for (const p of parts) w(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: p } })}\n\n`);
        w(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 7 } })}\n\n`);
      } else {
        for (const p of parts) w(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: p }] } }] })}\n\n`);
        w(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "" }] } }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 } })}\n\n`);
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  stub.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  stub.close = () => new Promise((r) => server.close(() => r()));
  return stub;
}

export interface Harness {
  pool: pg.Pool;
  app: Awaited<ReturnType<typeof buildApp>>["app"];
  runner: Awaited<ReturnType<typeof buildApp>>["runner"];
  issuer: ReturnType<typeof createTestIssuer>;
  stub: Stub;
  kek: string;
  /** Calls made to the content and quiz services. */
  upstreamCalls: { service: string; path: string; method: string; body: any; bearer: string }[];
  /** Per-path canned upstream answers: key is `${service} ${method} ${path-prefix}`. */
  upstreamReplies: Map<string, { status: number; json: any }>;
  close(): Promise<void>;
}

export async function createHarness(opts: { vault?: boolean; env?: Record<string, string>; keepDb?: boolean } = {}): Promise<Harness> {
  const pool = new pg.Pool({ connectionString: testDbUrl });
  if (!opts.keepDb) {
    await pool.query("DROP SCHEMA IF EXISTS ai CASCADE");
    await pool.query("DELETE FROM public.ultimyr_migrations WHERE service = 'ai'").catch(() => {});
  }
  await migrate(pool, { service: "ai", dir: resolve(import.meta.dirname, "../migrations") });
  const stub = await startStub();
  const kek = newKek();
  const cfg = loadAiConfig({
    NODE_ENV: "test",
    AI_ALLOW_INSECURE_PROVIDER: "true",
    AI_BASE_URL_GEMINI: stub.url,
    AI_BASE_URL_OPENAI: stub.url,
    AI_BASE_URL_ANTHROPIC: stub.url,
    ...(opts.vault === false ? {} : { ULTIMYR_VAULT_KEK: kek }),
    ...opts.env,
  });
  const issuer = createTestIssuer();
  const upstreamCalls: Harness["upstreamCalls"] = [];
  const upstreamReplies: Harness["upstreamReplies"] = new Map();
  const upstream: Upstream = async (service, path, bearer, init) => {
    const method = init?.method ?? "GET";
    upstreamCalls.push({ service, path, method, body: init?.body, bearer });
    for (const [k, v] of upstreamReplies) if (`${service} ${method} ${path}`.startsWith(k)) return v;
    return { status: 404, json: { error: "not_found" } };
  };
  const { app, runner } = await buildApp({ pool, keySource: issuer.publicKey, cfg, upstream });
  return {
    pool,
    app,
    runner,
    issuer,
    stub,
    kek,
    upstreamCalls,
    upstreamReplies,
    async close() {
      await runner.idle();
      await app.close();
      await stub.close();
      await pool.end();
    },
  };
}
