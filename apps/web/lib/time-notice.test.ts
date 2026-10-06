import { describe, expect, it } from "vitest";
import { timeNotice } from "./quiz";

describe("timeNotice", () => {
  it("says how long is left the first time the clock is seen", () => {
    expect(timeNotice(null, 42)).toBe("42 minutes remaining.");
    expect(timeNotice(null, 1)).toBe("1 minute remaining.");
  });
  it("stays quiet between milestones", () => {
    expect(timeNotice(43, 42)).toBeNull();
    expect(timeNotice(12, 11)).toBeNull();
    expect(timeNotice(7, 7)).toBeNull();
  });
  it("speaks when a milestone is reached", () => {
    expect(timeNotice(31, 30)).toBe("30 minutes remaining.");
    expect(timeNotice(6, 5)).toBe("5 minutes remaining.");
    expect(timeNotice(2, 1)).toBe("1 minute remaining.");
  });
  it("speaks once if a minute is skipped (a tab that slept)", () => {
    expect(timeNotice(20, 9)).toBe("9 minutes remaining.");
  });
  it("never speaks at or after zero", () => {
    expect(timeNotice(1, 0)).toBeNull();
  });
});
