/**
 * Splitting a mock exam across the exam's domains. Pure: the same inputs always give the same counts.
 *
 * Each bucket is a share of the exam in basis points (10000 = all of it) and has a number of questions available.
 * Counts follow the shares by largest remainder, never exceed what is available, and any shortfall is handed to the
 * buckets that still have questions, in proportion to their shares, so the exam always reaches `count` when enough exist.
 */
export interface Bucket {
  id: string;
  weightBp: number;
  available: number;
}

export function allocate(buckets: Bucket[], count: number): Map<string, number> {
  const out = new Map(buckets.map((b) => [b.id, 0]));
  const total = Math.min(count, buckets.reduce((s, b) => s + b.available, 0));
  const open = () => buckets.filter((b) => (out.get(b.id) ?? 0) < b.available);

  // First pass: largest remainder on the shares, capped by availability.
  const sum = buckets.reduce((s, b) => s + b.weightBp, 0);
  if (sum > 0) {
    const raw = buckets.map((b) => ({ b, exact: (b.weightBp / sum) * total }));
    let given = 0;
    for (const r of raw) {
      const n = Math.min(Math.floor(r.exact), r.b.available);
      out.set(r.b.id, n);
      given += n;
    }
    const order = [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.b.id.localeCompare(b.b.id));
    for (const r of order) {
      if (given >= total) break;
      if ((out.get(r.b.id) ?? 0) < r.b.available && r.exact - Math.floor(r.exact) > 0) {
        out.set(r.b.id, (out.get(r.b.id) ?? 0) + 1);
        given++;
      }
    }
  }
  // Second pass: top up from whatever is left, heaviest shares first.
  let given = [...out.values()].reduce((s, n) => s + n, 0);
  while (given < total) {
    const room = open().sort((a, b) => b.weightBp - a.weightBp || a.id.localeCompare(b.id));
    if (!room.length) break;
    for (const b of room) {
      if (given >= total) break;
      out.set(b.id, (out.get(b.id) ?? 0) + 1);
      given++;
    }
  }
  return out;
}
