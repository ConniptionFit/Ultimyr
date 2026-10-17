import { describe, expect, it } from "vitest";
import { allocate } from "../src/blueprint.js";

const counts = (m: Map<string, number>) => Object.fromEntries(m);

describe("mock exam blueprint", () => {
  it("follows the shares exactly when they divide evenly", () => {
    expect(counts(allocate([{ id: "a", weightBp: 5000, available: 99 }, { id: "b", weightBp: 3000, available: 99 }, { id: "c", weightBp: 2000, available: 99 }], 50))).toEqual({ a: 25, b: 15, c: 10 });
  });
  it("uses largest remainder so the total is exact", () => {
    const r = allocate([{ id: "a", weightBp: 3334, available: 99 }, { id: "b", weightBp: 3333, available: 99 }, { id: "c", weightBp: 3333, available: 99 }], 10);
    expect([...r.values()].reduce((s, n) => s + n, 0)).toBe(10);
    expect(Math.max(...r.values())).toBe(4);
  });
  it("never asks a domain for more than it has and gives the rest to others", () => {
    const r = allocate([{ id: "a", weightBp: 5000, available: 2 }, { id: "b", weightBp: 5000, available: 50 }], 20);
    expect(counts(r)).toEqual({ a: 2, b: 18 });
  });
  it("returns fewer questions only when fewer exist", () => {
    expect([...allocate([{ id: "a", weightBp: 1, available: 3 }, { id: "b", weightBp: 1, available: 2 }], 20).values()].reduce((s, n) => s + n, 0)).toBe(5);
    expect(counts(allocate([], 10))).toEqual({});
  });
  it("spreads questions by availability when no shares are given", () => {
    const r = allocate([{ id: "a", weightBp: 0, available: 5 }, { id: "b", weightBp: 0, available: 5 }], 6);
    expect([...r.values()].reduce((s, n) => s + n, 0)).toBe(6);
  });
  it("is deterministic and keeps a zero-weight domain empty while others have room", () => {
    const b = [{ id: "a", weightBp: 10_000, available: 10 }, { id: "z", weightBp: 0, available: 10 }];
    expect(counts(allocate(b, 5))).toEqual({ a: 5, z: 0 });
    expect(counts(allocate(b, 5))).toEqual(counts(allocate(b, 5)));
  });
});
