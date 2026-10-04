import { parseEnv } from "@ultimyr/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4003),
  HOST: z.string().default("0.0.0.0"),
  /** Auth service base URL: where access tokens are verified (JWKS). */
  AUTH_URL: z.url().default("http://localhost:4001"),
  /** Content service base URL: who may attempt or edit a quiz is decided there. */
  CONTENT_URL: z.url().default("http://localhost:4002"),
});

export function loadQuizConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = parseEnv(schema, env);
  return { nodeEnv: e.NODE_ENV, port: e.PORT, host: e.HOST, authUrl: e.AUTH_URL.replace(/\/$/, ""), contentUrl: e.CONTENT_URL.replace(/\/$/, "") };
}
export type QuizConfig = ReturnType<typeof loadQuizConfig>;
