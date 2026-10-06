import { describe, expect, it } from "vitest";
import { fallbackError } from "./auth-errors";

describe("fallbackError", () => {
  it("tells people to wait when rate limited", () => {
    expect(fallbackError({ status: 429, code: "Rate limit exceeded, retry in 28 seconds" })).toMatch(/Wait a minute/);
  });
  it("uses the generic message for anything else", () => {
    expect(fallbackError({ status: 500 })).toBe("Something went wrong. Please try again.");
    expect(fallbackError(new Error("x"))).toBe("Something went wrong. Please try again.");
    expect(fallbackError(null)).toBe("Something went wrong. Please try again.");
  });
});
