import { describe, expect, it } from "vitest";
import { createPool } from "../src/index.js";

const env = { DATABASE_URL: "postgres://u:p@localhost:5432/d" };

describe("createPool", () => {
  it("has sane timeouts by default", async () => {
    const pool = createPool(env);
    expect(pool.options.connectionTimeoutMillis).toBe(10_000);
    expect(pool.options.statement_timeout).toBe(30_000);
    await pool.end();
  });
  it("reads timeouts from the environment and ignores junk", async () => {
    const pool = createPool({ ...env, PG_CONNECT_TIMEOUT_MS: "2500", PG_STATEMENT_TIMEOUT_MS: "0" });
    expect(pool.options.connectionTimeoutMillis).toBe(2500);
    expect(pool.options.statement_timeout).toBe(0);
    await pool.end();
    const bad = createPool({ ...env, PG_CONNECT_TIMEOUT_MS: "soon", PG_STATEMENT_TIMEOUT_MS: "-5" });
    expect(bad.options.connectionTimeoutMillis).toBe(10_000);
    expect(bad.options.statement_timeout).toBe(30_000);
    await bad.end();
  });
  it("does not crash when an idle connection errors", async () => {
    const pool = createPool(env);
    const log = console.error;
    console.error = () => undefined;
    try {
      expect(() => pool.emit("error", new Error("terminating connection"))).not.toThrow();
    } finally {
      console.error = log;
      await pool.end();
    }
  });
});
