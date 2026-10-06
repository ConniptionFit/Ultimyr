import { describe, expect, it } from "vitest";
import { searchNotes } from "./note-search";

describe("searchNotes", () => {
  const notes = [
    { stepId: "1", content: "## Summary\nTokens and the context window decide cost." },
    { stepId: "2", content: "Prompt caching reduces repeat cost." },
  ];
  it("finds notes with every word, any case", () => {
    expect(searchNotes(notes, "CONTEXT cost").map((h) => h.stepId)).toEqual(["1"]);
    expect(searchNotes(notes, "cost").map((h) => h.stepId)).toEqual(["1", "2"]);
  });
  it("returns nothing for an empty or unmatched query", () => {
    expect(searchNotes(notes, " ")).toEqual([]);
    expect(searchNotes(notes, "kubernetes")).toEqual([]);
  });
  it("makes a short snippet", () => {
    expect(searchNotes([{ stepId: "x", content: "a".repeat(200) + " needle " + "b".repeat(200) }], "needle")[0]!.snippet.length).toBeLessThan(160);
  });
});
