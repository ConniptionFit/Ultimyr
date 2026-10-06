export interface GridDay {
  date: string;
  count: number;
  /** 0 = nothing, 1 to 4 = darker with more activity. */
  level: 0 | 1 | 2 | 3 | 4;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Level 1 to 4 relative to the busiest day, so a light studier still sees a pattern. */
export function levelFor(count: number, max: number): GridDay["level"] {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as GridDay["level"];
}

/**
 * Columns of seven days (Monday first) covering the last `weeks` weeks up to and including `today` (UTC dates).
 * Cells after today are null so the last column can be short. `counts` maps YYYY-MM-DD to an amount.
 */
export function buildGrid(today: Date, counts: Record<string, number>, weeks = 12): (GridDay | null)[][] {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const mondayOffset = (end.getUTCDay() + 6) % 7;
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - mondayOffset - (weeks - 1) * 7);
  const max = Math.max(0, ...Object.values(counts));
  const grid: (GridDay | null)[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: (GridDay | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + w * 7 + d);
      if (day > end) col.push(null);
      else {
        const date = iso(day);
        const count = counts[date] ?? 0;
        col.push({ date, count, level: levelFor(count, max) });
      }
    }
    grid.push(col);
  }
  return grid;
}

/** Days from the earliest cell to today. The API is asked for this many days. */
export function gridSpanDays(today: Date, weeks = 12): number {
  return ((today.getUTCDay() + 6) % 7) + (weeks - 1) * 7 + 1;
}
