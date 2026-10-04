import { describe, expect, it } from "vitest";
import { parseOutline } from "../src/outline.js";

describe("outline parser", () => {
  it("builds stages and nested steps with minutes, optional and notes", () => {
    const o = parseOutline(`# Claude Architect
Six weeks, one hour a day.

## Week 1: Foundations
Start here.
- [Prep hub](https://anthropic-partners.skilljar.com/hub#prep) 90m
  - [Lesson 1](https://youtu.be/abc?si=x) 12 min -- watch twice
  - [[Intro guide]]
    - Summarise it (optional)
- Practice exam 1h30m (optional) — aim for 70%

## Week 2
1. https://example.com/docs
`);
    expect(o.summary).toBe("Six weeks, one hour a day.");
    expect(o.stages.map((s) => s.title)).toEqual(["Week 1: Foundations", "Week 2"]);
    expect(o.stages[0]!.summary).toBe("Start here.");
    const [hub, exam] = o.stages[0]!.steps;
    expect(hub).toMatchObject({ link: { url: "https://anthropic-partners.skilljar.com/hub#prep", title: "Prep hub" }, minutes: 90, required: true });
    expect(hub!.steps[0]).toMatchObject({ link: { url: "https://youtu.be/abc", title: "Lesson 1" }, minutes: 12, note: "watch twice" });
    expect(hub!.steps[1]).toMatchObject({ itemTitle: "Intro guide" });
    expect(hub!.steps[1]!.steps[0]).toMatchObject({ milestone: "Summarise it", required: false });
    expect(exam).toMatchObject({ milestone: "Practice exam", minutes: 90, required: false, note: "aim for 70%" });
    expect(o.stages[1]!.steps[0]!.link!.title).toBe("example.com");
    expect(o.warnings).toEqual([]);
  });

  it("starts a default stage, rejects unsafe links and limits depth", () => {
    const o = parseOutline("- [Bad](http://example.com)\n- [Evil](javascript:alert(1))\n- a\n  - b\n    - c\n      - d\n");
    expect(o.stages[0]!.title).toBe("Roadmap");
    expect(o.stages[0]!.steps[0]).toMatchObject({ milestone: "Bad" });
    expect(o.stages[0]!.steps[1]).toMatchObject({ milestone: "Evil" });
    const a = o.stages[0]!.steps[2]!;
    expect(a.steps[0]!.steps[0]!.milestone).toBe("c");
    expect(a.steps[0]!.steps[1]!.milestone).toBe("d"); // moved up one level
    expect(o.warnings.some((w) => w.includes("not https"))).toBe(true);
    expect(o.warnings.some((w) => w.includes("at most 3 levels"))).toBe(true);
  });
});
