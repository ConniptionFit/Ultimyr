import { describe, expect, it } from "vitest";
import { formatSpent, paceSummary } from "./quiz";

describe("pace", () => {
  it("formats seconds and minutes", () => {
    expect(formatSpent(42_400)).toBe("42 s");
    expect(formatSpent(80_000)).toBe("1 min 20 s");
    expect(formatSpent(120_000)).toBe("2 min");
  });
  it("is null with no time recorded", () => {
    expect(paceSummary([])).toBeNull();
    expect(paceSummary([0, 0])).toBeNull();
  });
  it("names the average and the slowest question", () => {
    expect(paceSummary([30_000, 90_000, 60_000])).toBe("About 1 min per question. Slowest was question 2 (1 min 30 s).");
    expect(paceSummary([45_000])).toBe("About 45 s per question.");
  });
});
