import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberReturn, takeReturn } from "./after-login";

function stubStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
}
afterEach(() => vi.unstubAllGlobals());

describe("after sign in return path", () => {
  it("remembers the consent page once", () => {
    stubStorage();
    rememberReturn("/connect?client_id=abc");
    expect(takeReturn()).toBe("/connect?client_id=abc");
    expect(takeReturn()).toBeNull();
  });
  it("refuses anything else, so it cannot be an open redirect", () => {
    stubStorage();
    for (const p of ["https://evil.example", "//evil.example", "/settings", "/connect"]) {
      rememberReturn(p);
      expect(takeReturn()).toBeNull();
    }
  });
  it("copes with blocked storage", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} });
    expect(() => rememberReturn("/connect?x=1")).not.toThrow();
    expect(takeReturn()).toBeNull();
  });
});
