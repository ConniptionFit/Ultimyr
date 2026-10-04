import type { Question } from "./questions.js";

/** Small deterministic PRNG (mulberry32 seeded by an xmur3 string hash). For presentation only; grading never uses it. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Choose and order the questions for an attempt. The same seed always gives the same form. */
export function selectQuestions<T extends { id: string }>(pool: T[], opts: { count?: number | null; shuffle: boolean; seed: string }): T[] {
  const rnd = seededRandom(`select:${opts.seed}`);
  const ordered = opts.shuffle ? shuffle(pool, rnd) : [...pool];
  return opts.count ? ordered.slice(0, opts.count) : ordered;
}

/** The learner-visible form of a question for one attempt, with option order shuffled by the seed. */
export function presentQuestion(q: Question, seed: string, shuffleOptions: boolean): Record<string, unknown> {
  const { key: _k, ...rest } = q;
  void _k;
  if (!shuffleOptions) return rest;
  const rnd = seededRandom(`opts:${seed}:${q.id}`);
  if (q.type === "mcq" || q.type === "multi") return { ...rest, payload: { ...q.payload, options: shuffle(q.payload.options, rnd) } };
  if (q.type === "dnd") return { ...rest, payload: { ...q.payload, items: shuffle(q.payload.items, rnd) } };
  return rest;
}
