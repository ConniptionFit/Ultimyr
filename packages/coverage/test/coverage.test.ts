import { describe, expect, it } from "vitest";
import { buildCoverage, topGaps, type MaterialCounts, type ObjectiveNode, type QuizStats } from "../src/index.js";

const c = (guides = 0, decks = 0, cards = 0, resources = 0): MaterialCounts => ({ guides, decks, cards, resources });
const node = (id: string, counts: MaterialCounts, extra: Partial<ObjectiveNode> = {}): ObjectiveNode => ({ id, code: id, title: `Objective ${id}`, weightBp: null, counts, ...extra });
const stats = (objectives: QuizStats["objectives"], unmapped = 0): QuizStats => ({ objectives, unmapped: { questions: unmapped, drafts: 0, answered: 0, correct: 0, accuracyBp: null } });
const q = (objectiveId: string, questions: number, answered = 0, correct = 0, drafts = 0) => ({ objectiveId, questions, drafts, answered, correct, accuracyBp: answered ? Math.round((correct * 10000) / answered) : null });

const tree: ObjectiveNode[] = [
  node("1.0", c(1, 1, 12, 1), { weightBp: 6000, children: [node("1.1", c(1, 1, 8, 0)), node("1.2", c(0, 0, 2, 1)), node("1.3", c())] }),
  node("2.0", c(), { weightBp: 4000, children: [node("2.1", c(), { code: "2.1" })] }),
];

describe("coverage map", () => {
  it("marks each objective covered, thin or a gap and says what is missing", () => {
    const cov = buildCoverage(tree, stats([q("1.1", 4), q("1.2", 1)]));
    const [d1, d2] = cov.rows;
    expect(d1!.children!.map((k) => [k.id, k.status])).toEqual([["1.1", "covered"], ["1.2", "thin"], ["1.3", "gap"]]);
    expect(d1!.children![1]!.missing).toEqual(["flashcards (2 of 5)", "practice questions (1 of 3)"]);
    expect(d1!.children![2]!.missing).toEqual(["study material", "flashcards", "practice questions"]);
    expect(d1!.status).toBe("thin");
    expect(d1!.missing).toEqual(["2 of 3 objectives need more"]);
    expect(d2!.status).toBe("gap");
    expect(cov.summary).toMatchObject({ objectives: 4, covered: 1, thin: 1, gap: 2 });
  });

  it("says a thin objective lacks study material when only cards and questions exist", () => {
    const cov = buildCoverage([node("x", c(0, 0, 9))], stats([q("x", 5)]));
    expect(cov.rows[0]).toMatchObject({ status: "thin", missing: ["a study guide, deck or resource"] });
  });

  it("weights coverage by exam weight, counting thin as half", () => {
    const cov = buildCoverage(tree, stats([q("1.1", 4), q("1.2", 1)]));
    // Domain 1: (1 + 0.5 + 0) / 3 = 0.5 at 60%; domain 2: 0 at 40% => 30%.
    expect(cov.summary.coverageBp).toBe(3000);
    const full = buildCoverage([node("a", c(1, 0, 5, 0), { weightBp: 10000 })], stats([q("a", 3)]));
    expect(full.summary.coverageBp).toBe(10000);
  });

  it("gives domains without weights an equal share of what is left, and handles an empty tree", () => {
    const t = [node("a", c(1, 0, 5, 0)), node("b", c())];
    expect(buildCoverage(t, stats([q("a", 3)])).summary.coverageBp).toBe(5000);
    const empty = buildCoverage([], null);
    expect(empty.summary).toMatchObject({ objectives: 0, coverageBp: null, unmappedQuestions: 0 });
    expect(empty.rows).toEqual([]);
    expect(buildCoverage([node("a", c())], null).rows[0]!.status).toBe("gap"); // quiz service down: counts as none
  });

  it("reads mastery only when there are enough answers", () => {
    const cov = buildCoverage([node("a", c(1, 0, 5, 0)), node("b", c(1, 0, 5, 0)), node("c", c(1, 0, 5, 0))], stats([q("a", 3, 10, 4), q("b", 3, 10, 9), q("c", 3, 2, 0)]));
    expect(cov.rows.map((r) => r.mastery)).toEqual(["weak", "ok", "unknown"]);
    expect(cov.summary.weak).toBe(1);
  });

  it("rolls question counts and accuracy up into the domain", () => {
    const cov = buildCoverage(tree, stats([q("1.1", 4, 6, 3), q("1.2", 2, 4, 4, 1)]));
    expect(cov.rows[0]).toMatchObject({ questions: 6, drafts: 1, answered: 10, accuracyBp: 7000, mastery: "ok" });
  });

  it("carries the count of questions not mapped to any objective", () => {
    expect(buildCoverage(tree, stats([], 7)).summary.unmappedQuestions).toBe(7);
  });

  it("lists the gaps worth fixing first: empty before thin, then heavier domains first", () => {
    const cov = buildCoverage(tree, stats([q("1.1", 4), q("1.2", 1)]));
    expect(topGaps(cov).map((r) => r.id)).toEqual(["1.3", "2.1", "1.2"]);
    expect(topGaps(cov, 1).map((r) => r.id)).toEqual(["1.3"]);
    expect(topGaps(buildCoverage([node("a", c(1, 0, 5, 0))], stats([q("a", 3)])))).toEqual([]);
  });

  it("uses custom thresholds", () => {
    const cov = buildCoverage([node("a", c(1, 0, 2, 0))], stats([q("a", 1)]), { minCards: 2, minQuestions: 1 });
    expect(cov.rows[0]!.status).toBe("covered");
  });
});
