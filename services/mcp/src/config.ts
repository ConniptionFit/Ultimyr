import { parseEnv } from "@ultimyr/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4005),
  HOST: z.string().default("0.0.0.0"),
  AUTH_URL: z.url().default("http://localhost:4001"),
  CONTENT_URL: z.url().default("http://localhost:4002"),
  QUIZ_URL: z.url().default("http://localhost:4003"),
  NOTES_URL: z.url().default("http://localhost:4006"),
  /** The address people and MCP clients reach Ultimyr on. It names this server in OAuth metadata. */
  ULTIMYR_PUBLIC_URL: z.url().default("http://localhost:3000"),
  /** Requests per minute per person across all tools. */
  MCP_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  /** Write tool calls per minute per person. */
  MCP_WRITE_PER_MINUTE: z.coerce.number().int().min(1).default(30),
});

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = parseEnv(schema, env);
  const trim = (u: string) => u.replace(/\/$/, "");
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    authUrl: trim(e.AUTH_URL),
    contentUrl: trim(e.CONTENT_URL),
    quizUrl: trim(e.QUIZ_URL),
    notesUrl: trim(e.NOTES_URL),
    publicUrl: trim(e.ULTIMYR_PUBLIC_URL),
    ratePerMinute: e.MCP_RATE_PER_MINUTE,
    writesPerMinute: e.MCP_WRITE_PER_MINUTE,
  };
}
export type McpConfig = ReturnType<typeof loadMcpConfig>;
