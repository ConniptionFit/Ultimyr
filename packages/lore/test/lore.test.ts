import { describe, expect, it } from "vitest";
import { copy, parseNamingMode, streakText, term, terms } from "../src/index.js";

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
  it("has distinct, non empty copy for both modes", () => {
    for (const [key, v] of Object.entries(copy)) {
      expect(v.plain.length, key).toBeGreaterThan(0);
      expect(v.themed.length, key).toBeGreaterThan(0);
    }
  });
  it("words the streak in both modes", () => {
    expect(streakText(12, "themed")).toBe("Candle lit for 12 days.");
    expect(streakText(1, "plain")).toBe("1 day in a row.");
    expect(streakText(0, "plain")).toBe("No streak yet.");
  });
  it("falls back to plain on unknown values", () => {
    expect(parseNamingMode("nonsense")).toBe("plain");
    expect(parseNamingMode("plain")).toBe("plain");
    expect(term("guide", "plain")).toBe("Study guide");
  });
});
