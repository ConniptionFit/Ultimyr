import { describe, expect, it } from "vitest";
import { obsidianUrl, planNotes, safeName } from "../src/plan.js";
import { Sealer } from "../src/seal.js";
import { randomBytes } from "node:crypto";

const input = {
  archiveTitle: "Claude Architect",
  slug: "claude-architect",
  stages: [
    {
      title: "Week 1: Foundations",
      steps: [
        {
          id: "s1",
          title: "Prep hub",
          url: "https://anthropic-partners.skilljar.com/x",
          children: [
            { id: "s1a", title: "Lesson 1: Intro?", url: null, children: [] },
            { id: "s1b", title: "Lesson 2", url: "https://www.youtube.com/watch?v=abc", children: [] },
          ],
        },
        { id: "s2", title: "Practice test", url: null, children: [] },
      ],
    },
  ],
};

describe("note plan", () => {
  const notes = planNotes(input);
  it("lays notes out in path order with parents and children", () => {
    expect(notes.map((n) => n.path)).toEqual([
      "Ultimyr/claude-architect/00 Index.md",
      "Ultimyr/claude-architect/01 Week 1 Foundations/01 Prep hub.md",
      "Ultimyr/claude-architect/01 Week 1 Foundations/01 Prep hub/01 Lesson 1 Intro.md",
      "Ultimyr/claude-architect/01 Week 1 Foundations/01 Prep hub/02 Lesson 2.md",
      "Ultimyr/claude-architect/01 Week 1 Foundations/02 Practice test.md",
    ]);
  });
  it("keys step notes by step id with the standard frontmatter", () => {
    const n = notes.find((x) => x.stepId === "s1b")!;
    expect(n.content).toContain("ultimyr_step: s1b");
    expect(n.content).toContain("status: todo");
    expect(n.content).toContain("source: https://www.youtube.com/watch?v=abc");
    expect(n.content).toContain("## Flashcards");
  });
  it("links every step from the index", () => {
    const idx = notes[0]!.content;
    expect(idx).toContain("type: index");
    expect(idx).toContain("[[Ultimyr/claude-architect/01 Week 1 Foundations/01 Prep hub/02 Lesson 2|Lesson 2]]");
  });
  it("makes safe names and deep links", () => {
    expect(safeName("a/b:c?#d")).toBe("abcd");
    expect(safeName("???")).toBe("Untitled");
    expect(safeName("x".repeat(200)).length).toBe(80);
    expect(obsidianUrl("My Vault", "A/B C.md")).toBe("obsidian://open?vault=My%20Vault&file=A%2FB%20C");
  });
});

describe("sealer", () => {
  const s = new Sealer(1, new Map([[1, randomBytes(32)]]));
  it("round trips and binds to the person", () => {
    const blob = s.seal("u1", "secret-token");
    expect(blob.includes(Buffer.from("secret-token"))).toBe(false);
    expect(s.open("u1", blob)).toBe("secret-token");
    expect(() => s.open("u2", blob)).toThrow();
  });
  it("opens with an older key after rotation", () => {
    const k1 = randomBytes(32);
    const old = new Sealer(1, new Map([[1, k1]])).seal("u", "t");
    const rotated = Sealer.fromConfig(randomBytes(32).toString("base64"), 2, `1:${k1.toString("base64")}`)!;
    expect(rotated.open("u", old)).toBe("t");
  });
  it("is absent without a key", () => expect(Sealer.fromConfig(undefined)).toBeNull());
});
