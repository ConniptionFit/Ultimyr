import { describe, expect, it } from "vitest";
import { MAX_DAYS_LISTED, buildPlan, daysBetween, examChecklist, phaseFor, type PlanInput } from "../src/plan.js";

const base: PlanInput = { today: "2026-10-04", examDate: "2026-10-30", readinessBp: null, targetBp: null, weakAreas: [], minutesPerDay: 45, mode: "unknown" };
const plan = (o: Partial<PlanInput> = {}) => buildPlan({ ...base, ...o });
const on = (p: ReturnType<typeof plan>, left: number) => p.days.find((d) => d.daysLeft === left)!;
const kinds = (p: ReturnType<typeof plan>, left: number) => on(p, left).tasks.map((t) => t.kind);

describe("exam countdown plan", () => {
  it("counts days and picks a phase for each", () => {
    expect(daysBetween("2026-10-04", "2026-10-30")).toBe(26);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect([40, 22, 21, 8, 7, 3, 2, 1, 0].map(phaseFor)).toEqual(["build", "build", "consolidate", "consolidate", "sharpen", "sharpen", "taper", "taper", "exam"]);
  });

  it("lists every day to the exam when it is close, ending on exam day", () => {
    const p = plan({ examDate: "2026-10-14" });
    expect(p.status).toBe("upcoming");
    expect(p.daysLeft).toBe(10);
    expect(p.days).toHaveLength(11);
    expect(p.days[0]).toMatchObject({ date: "2026-10-04", daysLeft: 10, phase: "consolidate" });
    expect(p.days.at(-1)).toMatchObject({ date: "2026-10-14", daysLeft: 0, phase: "exam" });
    expect(p.days.map((d) => d.daysLeft)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(p.truncated).toBe(false);
    expect(p.phase).toBe("consolidate");
  });

  it("schedules practice exams on a rhythm and a day to redo the misses after each", () => {
    const p = plan({ examDate: "2026-10-25" }); // 21 days out
    for (const left of [21, 18, 15, 12, 9]) expect(kinds(p, left), `day ${left}`).toEqual(["review", "practice_exam"]);
    for (const left of [20, 17, 14, 11]) expect(on(p, left).tasks[1]).toMatchObject({ kind: "drill", focus: "missed" });
    expect(on(p, 19).tasks[1]).toMatchObject({ kind: "drill", focus: "weak" });
    const w = plan({ examDate: "2026-10-12" }); // 8 days out
    expect(kinds(w, 5)).toEqual(["review", "practice_exam"]);
    expect(on(w, 4).tasks[1]).toMatchObject({ focus: "missed" });
  });

  it("tapers: no practice exams and no new work in the last two days, with a checklist the day before", () => {
    const p = plan({ examDate: "2026-10-06" });
    expect(kinds(p, 2)).toEqual(["light_review"]);
    expect(kinds(p, 1)).toEqual(["light_review", "checklist"]);
    expect(kinds(p, 0)).toEqual(["light_review", "exam"]);
    expect(p.advice.join(" ")).toContain("Avoid new material");
    for (const d of p.days.filter((x) => x.daysLeft <= 2 && x.daysLeft >= 1)) expect(d.tasks.every((t) => t.kind !== "practice_exam" && t.kind !== "drill")).toBe(true);
  });

  it("rotates through weak topics by name", () => {
    const p = plan({ examDate: "2026-10-12", weakAreas: ["Networking", "Security"] });
    const titles = p.days.flatMap((d) => d.tasks).filter((t) => t.focus === "weak").map((t) => t.title);
    expect(titles[0]).toBe("Weak-area drill: Networking");
    expect(titles[1]).toBe("Weak-area drill: Security");
    expect(plan().days[0]!.tasks[1]!.title).toBe("Weak-area drill");
  });

  it("scales task lengths to the minutes available and keeps them sane", () => {
    const small = plan({ examDate: "2026-10-12", minutesPerDay: 15 });
    const big = plan({ examDate: "2026-10-12", minutesPerDay: 120 });
    expect(small.days[0]!.tasks.map((t) => t.minutes)).toEqual([5, 10]);
    expect(big.days[0]!.tasks.map((t) => t.minutes)).toEqual([40, 80]);
    expect(plan({ examDate: "2026-10-12", minutesPerDay: 5 }).days[0]!.tasks[0]!.minutes).toBe(5);
    expect(plan({ examDate: "2026-10-12", minutesPerDay: 100_000 }).days[0]!.tasks[0]!.minutes).toBe(170);
  });

  it("caps a long plan, keeping exam day and saying it was cut", () => {
    const p = plan({ examDate: "2027-02-01" });
    expect(p.truncated).toBe(true);
    expect(p.days).toHaveLength(MAX_DAYS_LISTED + 1);
    expect(p.days.at(-1)).toMatchObject({ date: "2027-02-01", daysLeft: 0, phase: "exam" });
    expect(p.days[0]!.phase).toBe("build");
    expect(p.phase).toBe("build");
  });

  it("handles exam day and a past exam date", () => {
    const today = plan({ examDate: "2026-10-04" });
    expect(today).toMatchObject({ status: "today", daysLeft: 0, phase: "exam" });
    expect(today.days).toHaveLength(1);
    const past = plan({ examDate: "2026-10-01" });
    expect(past).toMatchObject({ status: "past", phase: null, days: [] });
    expect(past.advice[0]).toContain("passed");
  });

  it("gives honest advice from readiness and target", () => {
    expect(plan().advice[0]).toContain("at least 3 practice attempts");
    expect(plan({ readinessBp: 8200, targetBp: 7500 }).advice[0]).toContain("meets your target");
    const behind = plan({ readinessBp: 5000, targetBp: 7500, examDate: "2026-10-08" });
    expect(behind.readiness.gapBp).toBe(2500);
    expect(behind.advice.join(" ")).toContain("25% points below");
    expect(behind.advice.join(" ")).toContain("rescheduling rules");
    // Far from the exam, a gap is just a gap.
    expect(plan({ readinessBp: 5000, targetBp: 7500 }).advice.join(" ")).not.toContain("rescheduling");
    // No target means no gap to talk about.
    expect(plan({ readinessBp: 5000 }).readiness.gapBp).toBeNull();
  });

  it("tailors the checklist to how the exam is taken, without promising provider rules", () => {
    expect(examChecklist("online").join(" ")).toContain("system check");
    expect(examChecklist("test_center").join(" ")).toContain("route");
    expect(examChecklist("unknown").join(" ")).toContain("centre or online");
    for (const m of ["online", "test_center", "unknown"] as const) expect(examChecklist(m).join(" ")).toContain("provider's own exam-day instructions");
  });
});
