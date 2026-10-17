import { describe, expect, it } from "vitest";
import { calibration } from "./quiz";

const q = (confidence: 1 | 2 | 3 | null, outcome?: "correct" | "incorrect" | "partial" | "unanswered") => ({ confidence, feedback: outcome ? { outcome } : undefined });

describe("calibration", () => {
  it("is null when nothing was rated", () => {
    expect(calibration([q(null, "correct"), q(null, "incorrect")])).toBeNull();
  });
  it("counts right answers per level and picks out lucky guesses and overconfident misses", () => {
    const c = calibration([q(1, "correct"), q(1, "incorrect"), q(3, "correct"), q(3, "incorrect"), q(2, "partial"), q(3, "unanswered"), q(3)])!;
    expect(c.rated).toBe(5);
    expect(c.levels).toEqual({ 1: { n: 2, right: 1 }, 2: { n: 1, right: 0 }, 3: { n: 2, right: 1 } });
    expect(c.lucky).toEqual([1]);
    expect(c.overconfident).toEqual([4]);
  });
});
