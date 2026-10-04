import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadAuthConfig } from "../src/config.js";
import { createHarness, testDbUrl } from "./helpers.js";

describe.skipIf(!testDbUrl)("response headers", () => {
  it("sets safe defaults on API responses", async () => {
    const h = await createHarness();
    const app = await buildApp({ pool: h.pool, keys: h.keys, config: loadAuthConfig({ NODE_ENV: "test" }) });
    try {
      const r = await app.inject({ method: "GET", url: "/v1/me" });
      expect(r.statusCode).toBe(401);
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["referrer-policy"]).toBe("no-referrer");
    } finally {
      await app.close();
      await h.close();
    }
  });
});
