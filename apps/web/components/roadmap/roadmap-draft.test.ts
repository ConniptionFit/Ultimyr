import { describe, expect, it } from "vitest";
import { move, nest, normalize, type Draft } from "./roadmap-draft";

const d = (label: string, depth: number, extra: Partial<Draft> = {}): Draft => ({ depth, label, milestone: label, note: "", required: true, minutes: null, ...extra });

describe("nest", () => {
  it("turns an indented list into nested steps", () => {
    const out = nest([d("a", 0), d("b", 1), d("c", 2), d("d", 1), d("e", 0)]);
    expect(out.map((s) => s.milestone)).toEqual(["a", "e"]);
    expect(out[0]!.steps!.map((s) => s.milestone)).toEqual(["b", "d"]);
    expect(out[0]!.steps![0]!.steps!.map((s) => s.milestone)).toEqual(["c"]);
  });
  it("never nests deeper than the step above allows", () => {
    const out = nest([d("a", 2), d("b", 2)]);
    expect(out.map((s) => s.milestone)).toEqual(["a"]);
    expect(out[0]!.steps!.map((s) => s.milestone)).toEqual(["b"]);
  });
  it("names an unnamed checkpoint", () => {
    expect(nest([d("", 0, { milestone: "" })])[0]!.milestone).toBe("Checkpoint");
  });
  it("keeps ids and prefers an existing item over a new link", () => {
    const [s] = nest([d("x", 0, { id: "s1", itemId: "i1", resource: { url: "https://a.example", title: "A" } })]);
    expect(s).toMatchObject({ id: "s1", itemId: "i1" });
    expect(s).not.toHaveProperty("resource");
  });
});

describe("normalize", () => {
  it("puts the first step at the top and limits each indent to one more than the step above", () => {
    expect(normalize([d("a", 2), d("b", 2), d("c", 0)]).map((s) => s.depth)).toEqual([0, 1, 0]);
  });
  it("caps depth at 2 and leaves valid lists alone", () => {
    const ok = [d("a", 0), d("b", 1), d("c", 2)];
    expect(normalize(ok)).toEqual(ok);
    expect(normalize([d("a", 0), d("b", 1), d("c", 2), d("d", 5)]).map((s) => s.depth)).toEqual([0, 1, 2, 2]);
  });
});

describe("move", () => {
  it("swaps neighbours and stays put at the ends", () => {
    expect(move([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 1, 1)).toEqual([1, 3, 2]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(move([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });
});
