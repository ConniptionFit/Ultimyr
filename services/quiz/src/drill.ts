/**
 * Choosing questions for a weak-area drill. Pure: the same inputs always give the same picks.
 *
 * Each question gets a priority from three things: how often the person has missed it (and whether the last try was a miss),
 * how weak the whole area is (its objective, else its domain), and how long since they last saw it. Questions never seen
 * sit in the middle, so a drill mixes known weak spots with fresh ground rather than only repeating mistakes.
 */
export type Focus = "mixed" | "weak" | "missed";

export interface QuestionStats {
  answered: number;
  /** Fully correct answers. Partial credit counts as an answer but not as correct. */
  correct: number;
  lastOutcome: "correct" | "partial" | "incorrect" | "unanswered" | null;
  lastAt: number | null;
}

export interface Candidate {
  id: string;
  /** The exam objective if the question is mapped to one, else its domain text, else null. */
  area: string | null;
  stats: QuestionStats;
}

export interface Pick {
  id: string;
  area: string | null;
  reason: "missed" | "weak_area" | "not_seen" | "refresh";
}

export interface DrillOptions {
  count: number;
  focus: Focus;
  now: number;
  seed: string;
}

const DAY = 86_400_000;
// A gentle assumption that a person knows most of what they are studying, worth three answers of evidence.
const PRIOR_MEAN = 0.7;
const PRIOR_WEIGHT = 3;
const smooth = (correct: number, answered: number) => (correct + PRIOR_MEAN * PRIOR_WEIGHT) / (answered + PRIOR_WEIGHT);
const wasMiss = (o: QuestionStats["lastOutcome"]) => o === "incorrect" || o === "unanswered" || o === "partial";

/** A small stable hash so ties break the same way every time for one seed. */
function jitter(seed: string, id: string): number {
  let h = 2166136261;
  for (const ch of `${seed}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

export function areaAccuracy(cands: Candidate[]): Map<string | null, number> {
  const sums = new Map<string | null, { c: number; n: number }>();
  for (const q of cands) {
    const s = sums.get(q.area) ?? { c: 0, n: 0 };
    s.c += q.stats.correct;
    s.n += q.stats.answered;
    sums.set(q.area, s);
  }
  return new Map([...sums].map(([k, v]) => [k, smooth(v.c, v.n)]));
}

export function selectDrill(cands: Candidate[], opts: DrillOptions): Pick[] {
  if (!cands.length || opts.count < 1) return [];
  const area = areaAccuracy(cands);
  const scored = cands.map((q) => {
    const seen = q.stats.answered > 0;
    const acc = smooth(q.stats.correct, q.stats.answered);
    const lastMiss = seen && wasMiss(q.stats.lastOutcome);
    const wrongness = seen ? 0.6 * (1 - acc) + 0.4 * (lastMiss ? 1 : 0) : 0.35;
    const areaWeak = 1 - (area.get(q.area) ?? PRIOR_MEAN);
    const stale = q.stats.lastAt === null ? 1 : Math.min(1, Math.max(0, (opts.now - q.stats.lastAt) / (14 * DAY)));
    const score = 0.5 * wrongness + 0.3 * areaWeak + 0.2 * stale + jitter(opts.seed, q.id) * 0.02;
    return { q, score, lastMiss, seen, areaWeak };
  });

  let pool = scored;
  if (opts.focus === "missed") pool = scored.filter((s) => s.lastMiss);
  else if (opts.focus === "weak") {
    // Only the weaker half of areas (at least one), so the drill leans into them.
    const ranked = [...area].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const keep = new Set(ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2))));
    pool = scored.filter((s) => keep.has(s.q.area));
  }
  pool = [...pool].sort((a, b) => b.score - a.score || a.q.id.localeCompare(b.q.id));

  // No one area may take more than 60% of a drill when others exist, so it stays varied.
  const areas = new Set(pool.map((s) => s.q.area));
  const cap = areas.size > 1 && opts.count >= 4 ? Math.ceil(opts.count * 0.6) : opts.count;
  const taken = new Map<string | null, number>();
  const picks: Pick[] = [];
  const left: typeof pool = [];
  for (const s of pool) {
    if (picks.length >= opts.count) break;
    if ((taken.get(s.q.area) ?? 0) >= cap) {
      left.push(s);
      continue;
    }
    taken.set(s.q.area, (taken.get(s.q.area) ?? 0) + 1);
    picks.push(toPick(s));
  }
  for (const s of left) {
    if (picks.length >= opts.count) break;
    picks.push(toPick(s));
  }
  return picks;
}

function toPick(s: { q: Candidate; lastMiss: boolean; seen: boolean; areaWeak: number }): Pick {
  const reason: Pick["reason"] = s.lastMiss ? "missed" : !s.seen ? "not_seen" : s.areaWeak > 0.3 ? "weak_area" : "refresh";
  return { id: s.q.id, area: s.q.area, reason };
}
