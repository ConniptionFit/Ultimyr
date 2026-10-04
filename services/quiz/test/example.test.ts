import { questionBodySchema, questionProblems } from "@ultimyr/scoring";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../apps/web/public/examples/comptia-aplus.json"), "utf8"));

describe("bundled example archive", () => {
  it("has a valid import document", () => {
    expect(doc).toMatchObject({ format: "ultimyr-archive", version: 1 });
    expect(doc.archive.title).toBeTruthy();
    expect(doc.items.map((i: { kind: string }) => i.kind).sort()).toEqual(["deck", "deck", "guide", "guide", "guide"]);
    for (const i of doc.items) {
      if (i.kind === "guide") expect(i.markdown).toMatch(/^# /);
      else expect(i.cards.length).toBeGreaterThan(5);
    }
  });

  it("has questions that pass the same checks as hand written ones", () => {
    expect(doc.quiz.questions.length).toBeGreaterThanOrEqual(10);
    const types = new Set<string>();
    for (const [i, q] of doc.quiz.questions.entries()) {
      const parsed = questionBodySchema.safeParse(q);
      expect(parsed.success, `question ${i}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
      expect(questionProblems(parsed.data!), `question ${i}`).toEqual([]);
      expect(q.explanation, `question ${i} explanation`).toBeTruthy();
      expect(q.domain, `question ${i} domain`).toBeTruthy();
      types.add(q.type);
    }
    expect([...types].sort()).toEqual(["dnd", "fib", "mcq", "multi"]);
  });

  it("does not claim to be official", () => {
    expect(doc.archive.overview).toMatch(/not official/i);
  });
});
