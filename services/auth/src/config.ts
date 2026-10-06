import { booleanFromEnv, parseEnv, readSecret } from "@ultimyr/config";
import { z } from "zod";
import { DEV_ENC_KEY_B64, DEV_PEPPER } from "./secrets.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4001),
  HOST: z.string().default("0.0.0.0"),
  AUTH_REGISTRATION: z.enum(["open", "closed"]).default("open"),
  COOKIE_SECURE: booleanFromEnv.optional(),
  ULTIMYR_PUBLIC_URL: z.url().optional(),
  ULTIMYR_ALLOW_INSECURE_IDP: booleanFromEnv.optional(),
  ULTIMYR_REPO: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/name").default("ConniptionFit/Ultimyr"),
  ULTIMYR_UPDATE_CHECK: booleanFromEnv.optional(),
  CONTENT_URL: z.url().optional(),
  QUIZ_URL: z.url().optional(),
  AI_URL: z.url().optional(),
  MCP_URL: z.url().optional(),
  NOTES_URL: z.url().optional(),
});

export interface AuthConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  registrationOpen: boolean;
  cookieSecure: boolean;
  jwtPrivateKeyPem: string | undefined;
  /** Browser-facing origin, used for WebAuthn and SSO callbacks (for example https://ultimyr.example.com). */
  publicUrl: string;
  /** Secrets for encrypting TOTP seeds and IdP client secrets, and for hashing API keys. */
  encKeyB64: string;
  pepper: string;
  /** Allow http:// identity providers (development and tests only). */
  allowInsecureIdp: boolean;
  /** GitHub repository (owner/name) shown in About and checked for newer releases. */
  repo: string;
  /** Admin panel > About asks GitHub for the latest release. Off for air-gapped installs. */
  updateCheck: boolean;
  /** Sibling services the admin status card checks (internal addresses, set in the environment, never by a request). */
  services: { name: string; url: string }[];
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const e = parseEnv(schema, env);
  const pem = readSecret("ULTIMYR_JWT_PRIVATE_KEY", env);
  if (e.NODE_ENV === "production" && !pem) {
    throw new Error("ULTIMYR_JWT_PRIVATE_KEY (or _FILE) is required in production. Generate one with: openssl genpkey -algorithm ed25519");
  }
  const encKey = readSecret("ULTIMYR_AUTH_ENC_KEY", env);
  const pepper = readSecret("ULTIMYR_API_KEY_PEPPER", env);
  if (e.NODE_ENV === "production" && (!encKey || !pepper)) {
    throw new Error(
      "ULTIMYR_AUTH_ENC_KEY and ULTIMYR_API_KEY_PEPPER (or _FILE) are required in production. Generate with: openssl rand -base64 32",
    );
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    registrationOpen: e.AUTH_REGISTRATION === "open",
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === "production",
    jwtPrivateKeyPem: pem,
    publicUrl: (e.ULTIMYR_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    encKeyB64: encKey ?? DEV_ENC_KEY_B64,
    pepper: pepper ?? DEV_PEPPER,
    allowInsecureIdp: e.ULTIMYR_ALLOW_INSECURE_IDP ?? e.NODE_ENV !== "production",
    repo: e.ULTIMYR_REPO,
    updateCheck: e.ULTIMYR_UPDATE_CHECK ?? e.NODE_ENV !== "test",
    services: (
      [
        ["Content", e.CONTENT_URL],
        ["Quizzes", e.QUIZ_URL],
        ["AI gateway", e.AI_URL],
        ["MCP", e.MCP_URL],
        ["Notes", e.NOTES_URL],
      ] as const
    ).flatMap(([name, url]) => (url ? [{ name, url: url.replace(/\/$/, "") }] : [])),
  };
}
