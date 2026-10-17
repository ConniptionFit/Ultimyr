import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICES } from "../src/services.js";

const read = (p: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, "../../..", p), "utf8")) as { dependencies?: Record<string, string> };

describe("api container dependencies", () => {
  // The image installs only this package's dependencies, and every service resolves its libraries from there.
  it("lists every third-party dependency of every service at the same version", () => {
    const api = read("apps/api/package.json").dependencies ?? {};
    const missing: string[] = [];
    for (const s of SERVICES) {
      for (const [name, version] of Object.entries(read(`services/${s.folder}/package.json`).dependencies ?? {})) {
        if (name.startsWith("@ultimyr/")) continue;
        if (api[name] !== version) missing.push(`${s.folder}: ${name}@${version} (api has ${api[name] ?? "nothing"})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("gives every service its own port", () => {
    expect(new Set(SERVICES.map((s) => s.port)).size).toBe(SERVICES.length);
  });
});
