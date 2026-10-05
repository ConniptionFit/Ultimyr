import { describe, expect, it } from "vitest";
import { DOT_GRID, makeShapes, mulberry32, sample, shapeCount, sizeAt, step } from "./dot-grid";

describe("dot grid", () => {
  it("is repeatable for a seed", () => {
    expect(makeShapes(6, 60, 40, 13, 7)).toEqual(makeShapes(6, 60, 40, 13, 7));
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });

  it("scales the number of shapes with the screen but never below the minimum", () => {
    expect(shapeCount(320, 480)).toBe(DOT_GRID.minShapes);
    expect(shapeCount(1440, 900)).toBe(DOT_GRID.shapes);
    expect(shapeCount(5000, 3000)).toBeLessThanOrEqual(DOT_GRID.shapes * 3);
  });

  it("keeps shapes drifting slowly and wrapping inside the field", () => {
    const shapes = makeShapes(9, 60, 40, 13, 3);
    for (const s of shapes) {
      expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(DOT_GRID.speedCells[1] + 1e-9);
      expect(s.icon).toBeGreaterThanOrEqual(0);
      expect(s.icon).toBeLessThan(13);
      for (let i = 0; i < 4000; i++) step(s, 0.5, 60, 40);
      expect(s.x).toBeGreaterThanOrEqual(-s.size - 1);
      expect(s.x).toBeLessThanOrEqual(60 + s.size + 1);
      expect(s.y).toBeGreaterThanOrEqual(-s.size - 1);
      expect(s.y).toBeLessThanOrEqual(40 + s.size + 1);
    }
  });

  it("breathes within eight percent of the base size", () => {
    const [s] = makeShapes(1, 60, 40, 13, 5);
    for (let t = 0; t < 100; t += 3) expect(Math.abs(sizeAt(s!, t) / s!.size - 1)).toBeLessThanOrEqual(0.0801);
  });

  it("samples a mask bilinearly and returns nothing outside it", () => {
    const mask = new Float32Array([0, 1, 0, 1]);
    expect(sample(mask, 2, 0, 0)).toBe(0);
    expect(sample(mask, 2, 0.5, 0)).toBeCloseTo(0.5);
    expect(sample(mask, 2, -0.1, 0.5)).toBe(0);
    expect(sample(mask, 2, 1, 0.5)).toBe(0);
  });
});
