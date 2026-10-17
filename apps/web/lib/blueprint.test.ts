import { describe, expect, it } from "vitest";
import type { ObjectiveTreeNode } from "./certs";
import { blueprintFrom } from "./blueprint";

const node = (id: string, weightBp: number | null, children: string[] = []): ObjectiveTreeNode => ({ id, code: "", title: `T${id}`, summary: "", weightBp, order: 0, counts: { guides: 0, decks: 0, cards: 0, resources: 0 }, children: children.map((c) => node(c, null)) });

describe("blueprintFrom", () => {
  it("uses weighted domains and includes their topics", () => {
    expect(blueprintFrom([node("d1", 3000, ["a", "b"]), node("d2", 7000, ["c"])])).toEqual([
      { title: "Td1", weightBp: 3000, objectiveIds: ["d1", "a", "b"] },
      { title: "Td2", weightBp: 7000, objectiveIds: ["d2", "c"] },
    ]);
  });
  it("skips domains without a weight and is empty when none has one", () => {
    expect(blueprintFrom([node("d1", null, ["a"]), node("d2", 0)])).toEqual([]);
    expect(blueprintFrom([node("d1", 5000), node("d2", null)]).map((e) => e.title)).toEqual(["Td1"]);
  });
});
