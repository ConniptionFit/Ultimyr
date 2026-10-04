import { describe, expect, it } from "vitest";
import { copy, parseNamingMode, term, terms } from "../src/index.js";

describe("lore", () => {
  it("every term has a distinct themed and plain name", () => {
    for (const [key, v] of Object.entries(terms)) {
      expect(v.themed, key).not.toEqual(v.plain);
      expect(v.plain.length, key).toBeGreaterThan(0);
    }
  });
  it("never uses em dashes in copy", () => {
    for (const v of Object.values(copy)) {
      expect(v.themed + v.plain).not.toMatch(/\u2014/);
    }
  });
  it("falls back to plain on unknown values", () => {
    expect(parseNamingMode("nonsense")).toBe("plain");
    expect(parseNamingMode("plain")).toBe("plain");
    expect(term("guide", "plain")).toBe("Study guide");
  });
});
