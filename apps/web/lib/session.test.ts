import { describe, expect, it } from "vitest";
import { leafSteps, planSession } from "./session";
import type { RoadmapStep } from "./types";

const step = (id: string, minutes: number | null, extra: Partial<RoadmapStep> = {}): RoadmapStep => ({ id, kind: "milestone", required: true, minutes, note: "", done: false, children: [], ...extra });

describe("planSession", () => {
  const leaves = [step("a", 20), step("b", 15), step("c", 30), step("d", null)];
  it("fits steps in order into the budget", () => {
    expect(planSession(leaves, 45).ids).toEqual(["a", "b"]);
    expect(planSession(leaves, 90).ids).toEqual(["a", "b", "c", "d"]);
  });
  it("always gives at least one step", () => {
    expect(planSession([step("x", 120)], 20).ids).toEqual(["x"]);
  });
  it("skips done and optional steps, and counts unknown minutes", () => {
    const l = [step("a", 20, { done: true }), step("b", 5, { required: false }), step("c", null), step("d", 10)];
    const p = planSession(l, 25);
    expect(p.ids).toEqual(["c", "d"]);
    expect(p.minutes).toBe(20);
  });
  it("flattens nested steps", () => {
    expect(leafSteps([step("p", null, { children: [step("a", 1), step("b", 2)] }), step("c", 3)]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
