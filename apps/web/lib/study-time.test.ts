import { describe, expect, it } from "vitest";
import { formatElapsed, formatMinutes, minutesToLog } from "./study-time";

describe("study time helpers", () => {
  it("formats minutes", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(65)).toBe("1 h 05 min");
    expect(formatMinutes(600)).toBe("10 h 00 min");
  });
  it("rounds a timer to whole minutes and ignores accidental taps", () => {
    expect(minutesToLog(10_000)).toBe(0);
    expect(minutesToLog(30_000)).toBe(1);
    expect(minutesToLog(25 * 60_000 + 20_000)).toBe(25);
    expect(minutesToLog(99 * 3_600_000)).toBe(1440);
  });
  it("formats a running timer", () => {
    expect(formatElapsed(5_000)).toBe("0:05");
    expect(formatElapsed(12 * 60_000 + 5_000)).toBe("12:05");
    expect(formatElapsed(3_600_000 + 2 * 60_000 + 9_000)).toBe("1:02:09");
  });
});
