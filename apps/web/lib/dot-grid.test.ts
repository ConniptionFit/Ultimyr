import { describe, expect, it } from "vitest";
import { DOT_GRID, angleAt, makeShapes, mulberry32, sample, shapeCount, sizeAt, step } from "./dot-grid";

describe("dot grid", () => {
  it("is repeatable for a seed", () => {
    expect(makeShapes(6, 60, 40, 8, 7)).toEqual(makeShapes(6, 60, 40, 8, 7));
    expect(mulberry32(1)()).toBe(mulberry32(1)());
  });

  it("scales the number of shapes with the screen but never below the minimum", () => {
    expect(shapeCount(320, 480)).toBe(DOT_GRID.minShapes);
    expect(shapeCount(1440, 900)).toBe(DOT_GRID.shapes);
    expect(shapeCount(5000, 3000)).toBeLessThanOrEqual(DOT_GRID.shapes * 3);
  });

  it("keeps shapes drifting slowly and wrapping inside the field", () => {
    const shapes = makeShapes(9, 60, 40, 8, 3);
    for (const s of shapes) {
      expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(DOT_GRID.speedCells[1] + 1e-9);
      expect(s.icon).toBeGreaterThanOrEqual(0);
      expect(s.icon).toBeLessThan(8);
      for (let i = 0; i < 4000; i++) step(s, 0.5, 60, 40);
      expect(s.x).toBeGreaterThanOrEqual(-s.size - 1);
      expect(s.x).toBeLessThanOrEqual(60 + s.size + 1);
      expect(s.y).toBeGreaterThanOrEqual(-s.size - 1);
      expect(s.y).toBeLessThanOrEqual(40 + s.size + 1);
    }
  });

  it("tilts every shape at a dutch angle and shows different icons side by side", () => {
    const shapes = makeShapes(7, 60, 40, 8, 5);
    expect(new Set(shapes.map((s) => s.icon)).size).toBe(7);
    for (const s of shapes) {
      const deg = (Math.abs(s.tilt) * 180) / Math.PI;
      expect(deg).toBeGreaterThanOrEqual(DOT_GRID.tilt[0] - 1e-9);
      expect(deg).toBeLessThanOrEqual(DOT_GRID.tilt[1] + 1e-9);
      for (let t = 0; t < 120; t += 7) {
        const a = (Math.abs(angleAt(s, t)) * 180) / Math.PI;
        expect(a).toBeGreaterThan(DOT_GRID.tilt[0] - DOT_GRID.sway - 1e-9);
        expect(a).toBeLessThan(DOT_GRID.tilt[1] + DOT_GRID.sway + 1e-9);
      }
    }
  });

  it("breathes within eight percent of the base size", () => {
    const [s] = makeShapes(1, 60, 40, 8, 5);
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
