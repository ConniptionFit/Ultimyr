import { describe, expect, it } from "vitest";
import { daysText, formatDay, formatDayShort } from "./certs";

describe("certification helpers", () => {
  it("shows plain days without shifting them by time zone", () => {
    expect(formatDay("2026-10-04")).toContain("2026");
    expect(formatDay("2026-10-04")).toContain("4");
    expect(formatDayShort("2026-01-01")).toContain("1");
    expect(formatDay(null)).toBe("");
    expect(formatDay("")).toBe("");
  });
  it("words a count of days", () => {
    expect(daysText(0)).toBe("today");
    expect(daysText(1)).toBe("tomorrow");
    expect(daysText(12)).toBe("in 12 days");
    expect(daysText(-1)).toBe("yesterday");
    expect(daysText(-5)).toBe("5 days ago");
    expect(daysText(null)).toBe("");
  });
});
