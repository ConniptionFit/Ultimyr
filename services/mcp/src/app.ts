import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SCOPES, type KeySource } from "@ultimyr/authz";
import Fastify, { type FastifyInstance } from "fastify";
import { Authenticator } from "./auth.js";
import type { McpConfig } from "./config.js";
import { RateLimiter } from "./limits.js";
import { buildServer } from "./tools.js";
import { createUpstream, type Upstream } from "./upstream.js";

export interface AppDeps {
  cfg: McpConfig;
  keySource: KeySource;
  upstream?: Upstream;
  fetch?: typeof fetch;
  now?: () => number;
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { cfg } = deps;
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true, bodyLimit: 6 * 1024 * 1024 });
  const upstream = deps.upstream ?? createUpstream(cfg, deps.fetch);
  const auth = new Authenticator(deps.keySource, cfg, deps.fetch, deps.now);
  const limiter = new RateLimiter(deps.now);
  const metadataUrl = `${cfg.publicUrl}/.well-known/oauth-protected-resource`;

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async () => ({ ok: true }));

  // OAuth protected resource metadata (RFC 9728): tells a client which authorization server to use.
  const metadata = async () => ({
    resource: `${cfg.publicUrl}/mcp`,
    authorization_servers: [cfg.publicUrl],
    bearer_methods_supported: ["header"],
    scopes_supported: [...SCOPES],
    resource_name: "Ultimyr",
  });
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) app.get(path, metadata);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  const rpcError = (code: number, message: string) => ({ jsonrpc: "2.0", error: { code, message }, id: null });

  // Stateless Streamable HTTP: every request is self contained and runs as the caller. No session to hijack, nothing to clean up.
  app.post("/mcp", async (req, reply) => {
    const authed = await auth.authenticate(req.headers.authorization);
    if (!authed) {
      return reply.code(401).header("www-authenticate", `Bearer realm="ultimyr", resource_metadata="${metadataUrl}"`).send(rpcError(-32001, "Unauthorized"));
    }
    if (!limiter.take(`r:${authed.principal.userId}`, cfg.ratePerMinute)) return reply.code(429).header("retry-after", "60").send(rpcError(-32002, "Rate limit exceeded"));

    const server = buildServer({ cfg, upstream, limiter, log: (e) => app.log.info(e) }, authed);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    reply.hijack();
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  const notAllowed = async (_req: unknown, reply: { code(n: number): { header(k: string, v: string): { send(b: unknown): unknown } } }) =>
    reply.code(405).header("allow", "POST").send(rpcError(-32000, "This server is stateless. Use POST."));
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  return app;
}
