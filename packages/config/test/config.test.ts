import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadDatabaseConfig, parseEnv } from "../src/index.js";

describe("loadDatabaseConfig", () => {
  it("prefers DATABASE_URL", () => {
    const c = loadDatabaseConfig({ DATABASE_URL: "postgres://u:p@h/db" });
    expect(c.connectionString).toBe("postgres://u:p@h/db");
    expect(c.ssl).toBe(false);
  });

  it("builds a URL from PG_* parts and encodes credentials", () => {
    const c = loadDatabaseConfig({
      PG_HOST: "db.internal",
      PG_USER: "ulti",
      PG_PASSWORD: "p@ss/word",
      PG_DATABASE: "ultimyr",
      PG_SSLMODE: "verify-full",
    });
    expect(c.connectionString).toBe("postgres://ulti:p%40ss%2Fword@db.internal:5432/ultimyr");
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("fails clearly when nothing is configured", () => {
    expect(() => loadDatabaseConfig({})).toThrow(/Database not configured/);
  });
});

describe("parseEnv", () => {
  it("reports every invalid variable", () => {
    expect(() => parseEnv(z.object({ A: z.string(), B: z.coerce.number() }), { B: "x" })).toThrow(/A:[\s\S]*B:/);
  });
});
