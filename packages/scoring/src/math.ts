export type Rounding = "half_up" | "floor" | "half_even";

/** Integer division n/d (d > 0) with an explicit rounding rule. Exact for safe integers. */
export function divRound(n: number, d: number, mode: Rounding): number {
  if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0) throw new RangeError("divRound needs integers and d > 0");
  const q = Math.floor(n / d);
  const r = n - q * d;
  let out: number;
  if (mode === "floor" || r === 0) out = q;
  else if (mode === "half_up") out = r * 2 >= d ? q + 1 : q;
  else if (r * 2 > d) out = q + 1;
  else if (r * 2 < d) out = q;
  else out = Math.abs(q) % 2 === 0 ? q : q + 1;
  return out === 0 ? 0 : out; // never return -0
}

/** A fraction of full marks, kept as integers until the final rounding. */
export interface Frac {
  num: number;
  den: number;
}
export const frac = (num: number, den: number): Frac => ({ num, den: den <= 0 ? 1 : den });
