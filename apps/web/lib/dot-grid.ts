/**
 * A field of small dots in which a few study shapes slowly float. Where a shape passes over the grid, the dots
 * under it grow and take its colour. Everything that sets the feel lives in `DOT_GRID` so it can be tuned in one place. The values follow the Fast Note Sync login background (a 15 second loop of seven shapes over a dense dot grid, about 12px apart at full size, shape colours taken from its gradients, matte opacity 0.5); only the shapes differ.
 */
export const DOT_GRID = {
  /** Distance between dots, in CSS pixels. */
  spacing: 12,
  /** Dot radius away from any shape, and under the middle of one. */
  baseRadius: 0.8,
  maxRadius: 3,
  /** Opacity of the resting dots, and of a fully covered dot. */
  baseAlpha: 0.3,
  maxAlpha: 0.5,
  /** Shapes on screen at 1440 x 900; scaled by area, never fewer than `minShapes`. */
  shapes: 7,
  minShapes: 4,
  /** Shape size in grid cells (width of the icon), and drift speed in cells per second. */
  sizeCells: [15, 26] as const,
  speedCells: [3, 7] as const,
  /** Dutch angle of each shape, in degrees away from upright (either way), and how far it slowly rocks about that angle. */
  tilt: [12, 30] as const,
  sway: 4,
  /** Seconds for one slow grow and shrink of a shape. */
  breathe: [15, 15] as const,
  /** Hues for shapes; lightness and saturation come from the theme below. */
  hues: [328, 210, 156, 14, 359, 41, 204] as const,
  light: { s: 80, l: 56 },
  dark: { s: 85, l: 60 },
  /** Resting dot colour per theme, as `r, g, b`. */
  restLight: "209, 209, 209",
  restDark: "163, 157, 139",
  /** Half width and height, in pixels, of the calm area around the page centre, and how much of the effect stays inside it (0 to 1). */
  quietX: 420,
  quietY: 300,
  quietFloor: 0.08,
  /** Cap on the frame rate. */
  fps: 30,
} as const;

export interface Rng {
  (): number;
}

/** A small seeded generator, so a given seed always gives the same layout. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Shape {
  /** Index into the icon list. */
  icon: number;
  hue: number;
  /** Centre in cells. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  /** Resting tilt in radians. */
  tilt: number;
  phase: number;
  breathe: number;
}

const between = (r: Rng, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * r();

/** How many shapes fit a viewport, scaled from the 1440 x 900 reference. */
export function shapeCount(width: number, height: number): number {
  const n = Math.round((DOT_GRID.shapes * width * height) / (1440 * 900));
  return Math.max(DOT_GRID.minShapes, Math.min(n, DOT_GRID.shapes * 3));
}

export function makeShapes(count: number, cols: number, rows: number, iconCount: number, seed: number): Shape[] {
  const r = mulberry32(seed);
  const out: Shape[] = [];
  // One shared offset, so the shapes on screen are different icons until the list runs out.
  const first = Math.floor(r() * iconCount);
  for (let i = 0; i < count; i++) {
    const heading = r() * Math.PI * 2;
    const speed = between(r, DOT_GRID.speedCells);
    out.push({
      icon: (i + first) % iconCount,
      hue: DOT_GRID.hues[i % DOT_GRID.hues.length]!,
      x: r() * cols,
      y: r() * rows,
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed,
      size: between(r, DOT_GRID.sizeCells),
      tilt: ((r() < 0.5 ? -1 : 1) * between(r, DOT_GRID.tilt) * Math.PI) / 180,
      phase: r() * Math.PI * 2,
      breathe: between(r, DOT_GRID.breathe),
    });
  }
  return out;
}

/** Move a shape by `dt` seconds. It drifts and wraps around the edges, so the field never empties. */
export function step(s: Shape, dt: number, cols: number, rows: number): void {
  const pad = s.size;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  if (s.x < -pad) s.x = cols + pad;
  else if (s.x > cols + pad) s.x = -pad;
  if (s.y < -pad) s.y = rows + pad;
  else if (s.y > rows + pad) s.y = -pad;
}

/** Current drawn size of a shape, breathing gently around its base size. */
export function sizeAt(s: Shape, t: number): number {
  return s.size * (1 + 0.08 * Math.sin((t / s.breathe) * Math.PI * 2 + s.phase));
}

/** Current angle of a shape in radians: its dutch angle, rocking a few degrees either way. */
export function angleAt(s: Shape, t: number): number {
  return s.tilt + ((DOT_GRID.sway * Math.PI) / 180) * Math.sin((t / (s.breathe * 1.3)) * Math.PI * 2 + s.phase * 2);
}

/** Bilinear lookup of a square coverage mask (values 0..1) at unit coordinates `u`, `v` in 0..1. */
export function sample(mask: Float32Array, n: number, u: number, v: number): number {
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
  const x = u * (n - 1);
  const y = v * (n - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(x0 + 1, n - 1);
  const y1 = Math.min(y0 + 1, n - 1);
  const a = mask[y0 * n + x0]! * (1 - fx) + mask[y0 * n + x1]! * fx;
  const b = mask[y1 * n + x0]! * (1 - fx) + mask[y1 * n + x1]! * fx;
  return a * (1 - fy) + b * fy;
}
