import { parseEnv } from "@ultimyr/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4002),
  HOST: z.string().default("0.0.0.0"),
  /** Auth service base URL: where access tokens are verified (JWKS) and group memberships come from. */
  AUTH_URL: z.url().default("http://localhost:4001"),
});

export function loadContentConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = parseEnv(schema, env);
  return { nodeEnv: e.NODE_ENV, port: e.PORT, host: e.HOST, authUrl: e.AUTH_URL.replace(/\/$/, "") };
}
export type ContentConfig = ReturnType<typeof loadContentConfig>;
