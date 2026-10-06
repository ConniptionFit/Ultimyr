import { describe, expect, it } from "vitest";
import { formatNext, isLeech, LEECH_LAPSES } from "./progress";

describe("formatNext", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  it("shows minutes for short intervals, at least one", () => {
    expect(formatNext({ due: "2026-10-05T12:10:00Z", days: 0 }, now)).toBe("10 min");
    expect(formatNext({ due: "2026-10-05T12:00:10Z", days: 0 }, now)).toBe("1 min");
  });
  it("shows days, then months", () => {
    expect(formatNext({ due: "x", days: 1 }, now)).toBe("1 day");
    expect(formatNext({ due: "x", days: 12 }, now)).toBe("12 days");
    expect(formatNext({ due: "x", days: 90 }, now)).toBe("3 months");
  });
});

describe("isLeech", () => {
  it("flags a card forgotten six or more times, and tolerates a missing count", () => {
    expect(isLeech({ lapses: 5 })).toBe(false);
    expect(isLeech({ lapses: LEECH_LAPSES })).toBe(true);
    expect(isLeech({})).toBe(false);
  });
});
