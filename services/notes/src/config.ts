import { parseEnv, readSecret } from "@ultimyr/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4006),
  HOST: z.string().default("0.0.0.0"),
  AUTH_URL: z.url().default("http://localhost:4001"),
  CONTENT_URL: z.url().default("http://localhost:4002"),
  /** The Fast Note Sync server. Set by the operator only: people never choose where the service connects. Unset switches notes off. */
  FNS_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  ULTIMYR_VAULT_KEK_VERSION: z.coerce.number().int().min(1).default(1),
});

export function loadNotesConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = parseEnv(schema, env);
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    authUrl: e.AUTH_URL.replace(/\/$/, ""),
    contentUrl: e.CONTENT_URL.replace(/\/$/, ""),
    fnsUrl: e.FNS_URL?.replace(/\/$/, ""),
    /** Seals each person's sync token. Same master key as the AI vault. Absent switches notes off. */
    kek: readSecret("ULTIMYR_VAULT_KEK", env),
    kekVersion: e.ULTIMYR_VAULT_KEK_VERSION,
    kekPrevious: env.ULTIMYR_VAULT_KEK_PREVIOUS,
  };
}
export type NotesConfig = ReturnType<typeof loadNotesConfig>;
