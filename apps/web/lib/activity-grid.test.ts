import { describe, expect, it } from "vitest";
import { buildGrid, gridSpanDays, levelFor } from "./activity-grid";

describe("activity grid", () => {
  // Wednesday 2026-10-07
  const today = new Date("2026-10-07T15:00:00Z");

  it("lays out Monday-first weeks that end today", () => {
    const g = buildGrid(today, {}, 3);
    expect(g).toHaveLength(3);
    expect(g[0]![0]!.date).toBe("2026-09-21"); // Monday two weeks before this week's Monday
    expect(g[2]![0]!.date).toBe("2026-10-05");
    expect(g[2]![2]!.date).toBe("2026-10-07");
    expect(g[2]![3]).toBeNull();
  });

  it("scales levels to the busiest day and keeps zero at zero", () => {
    expect(levelFor(0, 10)).toBe(0);
    expect(levelFor(1, 10)).toBe(1);
    expect(levelFor(10, 10)).toBe(4);
    expect(levelFor(5, 10)).toBe(2);
    expect(levelFor(3, 0)).toBe(0);
  });

  it("fills in counts by date", () => {
    const g = buildGrid(today, { "2026-10-06": 4, "2026-10-07": 2 }, 2);
    expect(g[1]![1]).toEqual({ date: "2026-10-06", count: 4, level: 4 });
    expect(g[1]![2]).toEqual({ date: "2026-10-07", count: 2, level: 2 });
  });

  it("asks the API for exactly the days the grid shows", () => {
    expect(gridSpanDays(today, 3)).toBe(2 + 14 + 1);
    const g = buildGrid(today, {}, 3);
    expect(g.flat().filter(Boolean)).toHaveLength(gridSpanDays(today, 3));
  });
});
