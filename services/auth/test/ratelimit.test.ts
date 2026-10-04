import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadAuthConfig } from "../src/config.js";
import { cookieOf, createHarness, register, testDbUrl, type Harness } from "./helpers.js";

describe.skipIf(!testDbUrl)("rate limits", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(() => h.reset());
  afterAll(() => h.close());

  it("keeps sign in strict but lets many page loads refresh a session", async () => {
    const app = await buildApp({ pool: h.pool, keys: h.keys, config: loadAuthConfig({ NODE_ENV: "test" }), rateLimitMax: 3, refreshRateMax: 40 });
    try {
      const reg = await register(app, "a@example.com");
      expect(reg.statusCode).toBe(201);
      let cookie = cookieOf(reg)!;
      // every full page load refreshes: a classroom behind one address must not be locked out
      for (let i = 0; i < 25; i++) {
        const r = await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { ultimyr_rt: cookie } });
        expect(r.statusCode, `refresh ${i}`).toBe(200);
        cookie = cookieOf(r)!;
      }
      // while password guessing is still capped
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push((await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "a@example.com", password: "wrong password" } })).statusCode);
      expect(codes).toContain(429);
    } finally {
      await app.close();
    }
  });
});
