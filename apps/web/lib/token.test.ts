import { describe, expect, it } from "vitest";
import { refreshDelay, tokenExpiry } from "./token";

const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`;

describe("tokenExpiry", () => {
  it("reads exp in milliseconds", () => {
    expect(tokenExpiry(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });
  it("copes with url-safe base64 and missing padding", () => {
    expect(tokenExpiry(jwt({ exp: 1_800_000_000, name: "Zoë ?>>" }))).toBe(1_800_000_000_000);
  });
  it("returns null for anything unreadable", () => {
    expect(tokenExpiry("nonsense")).toBeNull();
    expect(tokenExpiry("a.%%%.c")).toBeNull();
    expect(tokenExpiry(jwt({ sub: "x" }))).toBeNull();
    expect(tokenExpiry(jwt({ exp: "soon" }))).toBeNull();
  });
});

describe("refreshDelay", () => {
  it("renews one minute before expiry", () => {
    expect(refreshDelay(1_000_000 + 600_000, 1_000_000)).toBe(540_000);
  });
  it("never goes below 5 seconds, even for an expired token", () => {
    expect(refreshDelay(1_000_000 + 30_000, 1_000_000)).toBe(5_000);
    expect(refreshDelay(900_000, 1_000_000)).toBe(5_000);
  });
  it("assumes a ten minute token when the expiry is unknown", () => {
    expect(refreshDelay(null, 0)).toBe(540_000);
  });
});
