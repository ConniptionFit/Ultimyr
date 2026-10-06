import { describe, expect, it } from "vitest";
import { formatNext, isLeech, LEECH_LAPSES, sessionSummary } from "./progress";

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

describe("sessionSummary", () => {
  it("is null with no reviews", () => expect(sessionSummary([])).toBeNull());
  it("counts good and easy as remembered and rounds the time to a minute", () => {
    const notes = [
      { rating: 3, ms: 20_000 },
      { rating: 1, ms: 20_000 },
      { rating: 4, ms: 20_000 },
      { rating: 2, ms: 20_000 },
    ] as const;
    expect(sessionSummary([...notes])).toBe("4 reviews in about 1 minute. You remembered 2 of them (50%).");
    expect(sessionSummary([{ rating: 3, ms: 5_000 }])).toBe("1 review in about 1 minute. You remembered 1 of them (100%).");
  });
});
