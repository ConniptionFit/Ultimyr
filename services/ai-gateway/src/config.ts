import { booleanFromEnv, parseEnv, readSecret } from "@ultimyr/config";
import { z } from "zod";
import { DEFAULT_BASE_URLS, type Provider } from "./providers.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4004),
  HOST: z.string().default("0.0.0.0"),
  AUTH_URL: z.url().default("http://localhost:4001"),
  CONTENT_URL: z.url().default("http://localhost:4002"),
  QUIZ_URL: z.url().default("http://localhost:4003"),
  ULTIMYR_VAULT_KEK_VERSION: z.coerce.number().int().min(1).default(1),
  /** Per person per day, across chat, tests and generation. */
  AI_DAILY_REQUESTS: z.coerce.number().int().min(1).default(200),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(65_536).default(8192),
  AI_BASE_URL_GEMINI: z.url().optional(),
  AI_BASE_URL_OPENAI: z.url().optional(),
  AI_BASE_URL_ANTHROPIC: z.url().optional(),
  /** Allow plain http provider endpoints (local test servers only). */
  AI_ALLOW_INSECURE_PROVIDER: booleanFromEnv.optional(),
  AI_DEFAULT_MODEL_GEMINI: z.string().default("gemini-2.5-flash"),
  AI_DEFAULT_MODEL_OPENAI: z.string().default("gpt-4.1-mini"),
  AI_DEFAULT_MODEL_ANTHROPIC: z.string().default("claude-haiku-4-5-20251001"),
});

export function loadAiConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = parseEnv(schema, env);
  const baseUrls: Record<Provider, string> = { ...DEFAULT_BASE_URLS };
  for (const [p, v] of [["gemini", e.AI_BASE_URL_GEMINI], ["openai", e.AI_BASE_URL_OPENAI], ["anthropic", e.AI_BASE_URL_ANTHROPIC]] as const) {
    if (!v) continue;
    // Provider endpoints are an allowlist set by the operator, never by a user. Only https unless explicitly relaxed.
    if (!v.startsWith("https://") && !e.AI_ALLOW_INSECURE_PROVIDER) throw new Error(`AI_BASE_URL_${p.toUpperCase()} must be https (set AI_ALLOW_INSECURE_PROVIDER=true for local testing only)`);
    baseUrls[p] = v.replace(/\/$/, "");
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    authUrl: e.AUTH_URL.replace(/\/$/, ""),
    contentUrl: e.CONTENT_URL.replace(/\/$/, ""),
    quizUrl: e.QUIZ_URL.replace(/\/$/, ""),
    /** Master key for the vault. Absent means the vault, and therefore every AI feature, is switched off. */
    vaultKek: readSecret("ULTIMYR_VAULT_KEK", env),
    vaultKekVersion: e.ULTIMYR_VAULT_KEK_VERSION,
    vaultKekPrevious: env.ULTIMYR_VAULT_KEK_PREVIOUS,
    dailyRequests: e.AI_DAILY_REQUESTS,
    maxOutputTokens: e.AI_MAX_OUTPUT_TOKENS,
    baseUrls,
    defaultModels: { gemini: e.AI_DEFAULT_MODEL_GEMINI, openai: e.AI_DEFAULT_MODEL_OPENAI, anthropic: e.AI_DEFAULT_MODEL_ANTHROPIC } as Record<Provider, string>,
  };
}
export type AiConfig = ReturnType<typeof loadAiConfig>;
