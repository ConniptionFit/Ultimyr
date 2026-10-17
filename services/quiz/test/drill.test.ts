import { describe, expect, it } from "vitest";
import { selectDrill, areaAccuracy, type Candidate, type QuestionStats } from "../src/drill.js";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const DAY = 86_400_000;
const unseen: QuestionStats = { answered: 0, correct: 0, lastOutcome: null, lastAt: null };
const q = (id: string, area: string | null, stats: Partial<QuestionStats> = {}): Candidate => ({ id, area, stats: { ...unseen, ...stats } });
const opts = { count: 5, focus: "mixed" as const, now: NOW, seed: "s" };

describe("weak-area drill selection", () => {
  it("returns nothing for no questions or a zero count", () => {
    expect(selectDrill([], opts)).toEqual([]);
    expect(selectDrill([q("a", "x")], { ...opts, count: 0 })).toEqual([]);
  });

  it("puts recently missed questions ahead of ones answered correctly", () => {
    const picks = selectDrill(
      [
        q("good", "x", { answered: 4, correct: 4, lastOutcome: "correct", lastAt: NOW - DAY }),
        q("bad", "x", { answered: 3, correct: 0, lastOutcome: "incorrect", lastAt: NOW - DAY }),
        q("meh", "x", { answered: 2, correct: 1, lastOutcome: "correct", lastAt: NOW - DAY }),
      ],
      { ...opts, count: 3 },
    );
    expect(picks.map((p) => p.id)).toEqual(["bad", "meh", "good"]);
    expect(picks[0]!.reason).toBe("missed");
  });

  it("leans on the weakest area and shows fresh questions after known mistakes", () => {
    const cands = [
      q("n1", "net", { answered: 5, correct: 1, lastOutcome: "correct", lastAt: NOW - 20 * DAY }),
      q("n2", "net", { answered: 5, correct: 1, lastOutcome: "correct", lastAt: NOW - 20 * DAY }),
      q("s1", "sec", { answered: 5, correct: 5, lastOutcome: "correct", lastAt: NOW - 20 * DAY }),
      q("s2", "sec", { answered: 5, correct: 5, lastOutcome: "correct", lastAt: NOW - 20 * DAY }),
      q("new", "sec"),
    ];
    const ids = selectDrill(cands, { ...opts, count: 3 }).map((p) => p.id);
    expect(ids.slice(0, 2).sort()).toEqual(["n1", "n2"]);
    expect(ids).toContain("new");
  });

  it("focus missed keeps only questions whose last try was a miss; weak keeps only the weaker half of areas", () => {
    const cands = [
      q("m1", "a", { answered: 2, correct: 1, lastOutcome: "incorrect", lastAt: NOW }),
      q("m2", "b", { answered: 2, correct: 1, lastOutcome: "partial", lastAt: NOW }),
      q("ok", "b", { answered: 2, correct: 2, lastOutcome: "correct", lastAt: NOW }),
      q("fresh", "c"),
    ];
    expect(selectDrill(cands, { ...opts, focus: "missed" }).map((p) => p.id).sort()).toEqual(["m1", "m2"]);
    expect(selectDrill([q("x", "a", { answered: 3, correct: 3, lastOutcome: "correct", lastAt: NOW })], { ...opts, focus: "missed" })).toEqual([]);
    const weak = selectDrill(
      [
        q("w1", "weak", { answered: 6, correct: 1, lastOutcome: "incorrect", lastAt: NOW }),
        q("s1", "strong", { answered: 6, correct: 6, lastOutcome: "correct", lastAt: NOW }),
      ],
      { ...opts, focus: "weak" },
    );
    expect(weak.map((p) => p.id)).toEqual(["w1"]);
  });

  it("keeps a drill varied: one area cannot take more than 60% when others exist", () => {
    const cands = [
      ...Array.from({ length: 10 }, (_, i) => q(`a${i}`, "a", { answered: 5, correct: 0, lastOutcome: "incorrect", lastAt: NOW - DAY })),
      ...Array.from({ length: 5 }, (_, i) => q(`b${i}`, "b", { answered: 5, correct: 4, lastOutcome: "correct", lastAt: NOW - DAY })),
    ];
    const picks = selectDrill(cands, { ...opts, count: 10 });
    expect(picks).toHaveLength(10);
    expect(picks.filter((p) => p.area === "a")).toHaveLength(6);
    // With only one area there is nothing to vary, so it fills the drill.
    expect(selectDrill(cands.slice(0, 10), { ...opts, count: 10 })).toHaveLength(10);
    // When the other areas run out, the cap gives way rather than leaving the drill short.
    expect(selectDrill([...cands.slice(0, 10), q("b0", "b")], { ...opts, count: 10 })).toHaveLength(10);
  });

  it("never picks a question twice or more than asked, and is repeatable for one seed", () => {
    const cands = Array.from({ length: 30 }, (_, i) => q(`q${i}`, i % 3 === 0 ? null : `area${i % 3}`));
    const a = selectDrill(cands, { ...opts, count: 12 });
    expect(new Set(a.map((p) => p.id)).size).toBe(12);
    expect(selectDrill(cands, { ...opts, count: 12 })).toEqual(a);
    expect(selectDrill(cands, { ...opts, count: 100 })).toHaveLength(30);
    expect(selectDrill(cands, { ...opts, count: 12, seed: "other" }).map((p) => p.id).sort()).not.toEqual([]);
  });

  it("computes an area's accuracy from all its questions, nudged toward a prior when there is little data", () => {
    const m = areaAccuracy([q("a", "x", { answered: 10, correct: 0 }), q("b", "x", { answered: 0 }), q("c", "y")]);
    expect(m.get("x")!).toBeLessThan(0.2);
    expect(m.get("y")).toBeCloseTo(0.7);
  });
});

describe("drill focus: unseen and bookmarked", () => {
  const cands = [
    { ...q("seen", "x", { answered: 2, correct: 1, lastOutcome: "incorrect" as const, lastAt: NOW - DAY }), bookmarked: true },
    q("new1", "x"),
    { ...q("new2", "y"), bookmarked: true },
  ];
  it("unseen keeps only questions never answered", () => {
    expect(selectDrill(cands, { ...opts, focus: "unseen" }).map((p) => p.id).sort()).toEqual(["new1", "new2"]);
  });
  it("bookmarked keeps only bookmarked questions and says why", () => {
    const picks = selectDrill(cands, { ...opts, focus: "bookmarked" });
    expect(picks.map((p) => p.id).sort()).toEqual(["new2", "seen"]);
    expect(picks.find((p) => p.id === "new2")!.reason).toBe("bookmarked");
  });
});

describe("diagnostic focus", () => {
  it("takes the same number from every area, unseen first", () => {
    const cands = [
      ...["a1", "a2", "a3", "a4"].map((id) => q(id, "A")),
      ...["b1", "b2"].map((id) => q(id, "B")),
      q("c1", "C", { answered: 3, correct: 3, lastOutcome: "correct", lastAt: NOW - DAY }),
      q("c2", "C"),
    ];
    const picks = selectDrill(cands, { ...opts, focus: "diagnostic", count: 6 });
    const per = (area: string) => picks.filter((p) => p.area === area).length;
    expect([per("A"), per("B"), per("C")]).toEqual([2, 2, 2]);
    expect(picks.find((p) => p.area === "C" && p.id === "c2")).toBeTruthy();
    expect(picks.every((p) => p.reason === "not_seen" || p.id === "c1")).toBe(true);
  });
  it("uses everything when asked for more than exists, and does not repeat a question", () => {
    const picks = selectDrill([q("a1", "A"), q("a2", "A"), q("b1", "B")], { ...opts, focus: "diagnostic", count: 10 });
    expect(picks.map((p) => p.id).sort()).toEqual(["a1", "a2", "b1"]);
  });
});
