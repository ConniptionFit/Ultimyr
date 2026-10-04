import { booleanFromEnv, parseEnv, readSecret } from "@ultimyr/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4001),
  HOST: z.string().default("0.0.0.0"),
  AUTH_REGISTRATION: z.enum(["open", "closed"]).default("open"),
  COOKIE_SECURE: booleanFromEnv.optional(),
});

export interface AuthConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  registrationOpen: boolean;
  cookieSecure: boolean;
  jwtPrivateKeyPem: string | undefined;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const e = parseEnv(schema, env);
  const pem = readSecret("ULTIMYR_JWT_PRIVATE_KEY", env);
  if (e.NODE_ENV === "production" && !pem) {
    throw new Error("ULTIMYR_JWT_PRIVATE_KEY (or _FILE) is required in production. Generate one with: openssl genpkey -algorithm ed25519");
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    registrationOpen: e.AUTH_REGISTRATION === "open",
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === "production",
    jwtPrivateKeyPem: pem,
  };
}
