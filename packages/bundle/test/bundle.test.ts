import { describe, expect, it } from "vitest";
import { FORMAT_EXAMPLE, parseBundle, summarize } from "../src/index.js";

describe("bundle parser", () => {
  it("reads the example the assistant is given", () => {
    const b = parseBundle(FORMAT_EXAMPLE);
    expect(b.errors).toEqual([]);
    expect(b.warnings).toEqual([]);
    expect(b.archive).toEqual({ title: "Example Cert", vendor: "Example Vendor", overview: "One or two sentences about the certification." });
    expect(summarize(b)).toEqual({ objectives: 5, roadmap: 3, guides: 1, decks: 1, cards: 2, quizzes: 1, questions: 3 });
    expect(b.guides[0]).toMatchObject({ title: "Ports and protocols", objectiveCodes: ["1.1", "1.2"], summary: "The ports and transport protocols worth knowing." });
    expect(b.guides[0]!.markdown.startsWith("# Ports and protocols")).toBe(true);
    expect(b.decks[0]!.cards[0]).toEqual({ front: "What port does HTTPS use?", back: "443" });
  });

  it("builds payloads and keys for each question type", () => {
    const [mcq, multi, fib] = parseBundle(FORMAT_EXAMPLE).quizzes[0]!.questions;
    expect(mcq).toMatchObject({ type: "mcq", objectiveCode: "1.1", difficulty: 2, payload: { options: [{ id: "a", text: "21" }, { id: "b", text: "443" }, { id: "c", text: "25" }] }, key: { correct: "b" }, explanation: "HTTPS runs over TLS on port 443." });
    expect(multi).toMatchObject({ type: "multi", key: { correct: ["a", "b"] } });
    expect(fib).toMatchObject({ type: "fib", payload: { blanks: 1 }, key: { blanks: [{ accepted: ["443"] }] } });
  });

  it("ignores code fences around chunks but keeps fences inside guides", () => {
    const text = "```text\nultimyr-bundle v1\narchive: X\n=== guide: G ===\nsummary: s\n\n# G\n```sh\nls\n```\ndone\n=== end ===\n```\n";
    const b = parseBundle(text);
    expect(b.errors).toEqual([]);
    expect(b.guides[0]!.markdown).toBe("# G\n```sh\nls\n```\ndone");
  });

  it("merges chunks and accepts several fib answers", () => {
    const b = parseBundle("=== objectives ===\n## 1.0 A\n=== end ===\n=== objectives ===\n## 2.0 B\n=== end ===\n=== quiz: Q ===\nQ fib\nA is ___ and B is ___.\nAnswer: 1 | one\nAnswer: 2\n=== end ===");
    expect(b.objectives).toBe("## 1.0 A\n## 2.0 B");
    expect(b.quizzes[0]!.questions[0]!.key).toEqual({ blanks: [{ accepted: ["1", "one"] }, { accepted: ["2"] }] });
  });

  it("reports a cut-off block, and says which", () => {
    const b = parseBundle("=== guide: Half ===\nsummary: x\n\n# Half\nthe chat stopped here");
    expect(b.guides).toEqual([]);
    expect(b.errors[0]).toMatch(/Line 1: the guide block "Half" was never closed/);
    expect(b.errors[0]).toMatch(/cut off/);
    const b2 = parseBundle("=== guide: A ===\ntext\n=== deck: B ===\nq :: a\n=== end ===");
    expect(b2.errors[0]).toMatch(/guide block "A" was never closed/);
    expect(b2.decks).toHaveLength(1);
  });

  it("rejects bad cards and questions with line numbers", () => {
    const b = parseBundle("=== deck: D ===\ngood :: card\nno separator\n=== end ===\n=== quiz: Z ===\nQ mcq 1.1\nTwo right?\na) x *\nb) y *\n\nQ mcq\nNo options\n\nQ fib\nNo blank\nAnswer: x\n\nQ multi\nOne option?\na) only *\n=== end ===");
    expect(b.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/Line 3: write each card/),
      expect.stringMatching(/exactly one correct option marked.*found 2/),
      expect.stringMatching(/at least two options/),
      expect.stringMatching(/needs "___"/),
    ]));
    expect(b.decks[0]!.cards).toHaveLength(1);
  });

  it("flags unknown tokens, stray text and empty blocks", () => {
    const b = parseBundle("hello there\n=== quiz: Z ===\nQ mcq banana\nStem\na) x *\nb) y\n=== end ===\n=== guide ===\ntext\n=== end ===\n=== deck: E ===\n=== end ===");
    expect(b.warnings[0]).toMatch(/ignored text outside any block/);
    expect(b.errors.join("\n")).toMatch(/unexpected "banana"/);
    expect(b.errors.join("\n")).toMatch(/guide block needs a title/);
    expect(b.errors.join("\n")).toMatch(/Deck "E" has no cards/);
  });

  it("refuses oversized input", () => {
    expect(parseBundle("x".repeat(3_000_001)).errors[0]).toMatch(/longer than/);
  });
});

describe("coverage check", () => {
  it("finds what is short per objective", async () => {
    const { checkBundles, objectiveCodes } = await import("../src/index.js");
    const b = parseBundle(FORMAT_EXAMPLE);
    expect(objectiveCodes(b.objectives)).toEqual(["1.1", "1.2", "2.1"]);
    const c = checkBundles([b], "quick");
    expect(c.objectives).toBe(3);
    expect(c.gaps.find((g) => g.code === "2.1")).toEqual({ code: "2.1", guide: true, cardsMissing: 5, questionsMissing: 3 });
    expect(c.gaps.find((g) => g.code === "1.1")).toMatchObject({ guide: false, questionsMissing: 1 });
    expect(c.unknownCodes).toEqual([]);
  });
  it("flags unknown and missing codes", async () => {
    const { checkBundles } = await import("../src/index.js");
    const b = parseBundle("=== objectives ===\n- 1.1 A\n=== end ===\n=== quiz: Q ===\nQ mcq 9.9\nx?\na) y *\nb) z\n\nQ mcq\nx2?\na) y *\nb) z\n=== end ===");
    const c = checkBundles([b], "quick");
    expect(c.unknownCodes).toEqual(["9.9"]);
    expect(c.untaggedQuestions).toBe(1);
  });
});
