/**
 * FSRS-5 spaced repetition scheduler (Free Spaced Repetition Scheduler, open algorithm by Jarrett Ye et al.,
 * https://github.com/open-spaced-repetition). Pure functions: the caller supplies the time and the state, so the
 * same input always gives the same schedule. No fuzzing is applied, which keeps results reproducible and testable.
 */
export type Rating = 1 | 2 | 3 | 4; // again, hard, good, easy
export enum State {
  New = 0,
  Learning = 1,
  Review = 2,
  Relearning = 3,
}

export interface CardState {
  state: State;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  /** When the card was last reviewed, as epoch milliseconds. Null for a new card. */
  lastReview: number | null;
  /** When the card is next due, as epoch milliseconds. */
  due: number;
}

/** FSRS-5 default weights. */
export const DEFAULT_W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621] as const;

const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY = 86_400_000;
const MAX_INTERVAL_DAYS = 36_500;
const MIN_STABILITY = 0.01;

export interface Params {
  w: readonly number[];
  /** Target probability of recalling a card when it comes due, 0.7 to 0.99. */
  desiredRetention: number;
}
export const DEFAULT_PARAMS: Params = { w: DEFAULT_W, desiredRetention: 0.9 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const clampD = (d: number) => clamp(d, 1, 10);

export const newCard = (now: number): CardState => ({ state: State.New, stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: null, due: now });

/** Probability of recalling a card `elapsedDays` after its last review. */
export function retrievability(stability: number, elapsedDays: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY);
}

/** Days until retrievability falls to the desired retention. Whole days, at least 1. */
export function nextInterval(stability: number, desiredRetention: number): number {
  const days = (stability / FACTOR) * (Math.pow(desiredRetention, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_INTERVAL_DAYS);
}

const initStability = (w: readonly number[], g: Rating) => Math.max(w[g - 1]!, MIN_STABILITY);
const initDifficulty = (w: readonly number[], g: Rating) => clampD(w[4]! - Math.exp(w[5]! * (g - 1)) + 1);

function nextDifficulty(w: readonly number[], d: number, g: Rating): number {
  const delta = -w[6]! * (g - 3);
  const damped = d + (delta * (10 - d)) / 9;
  // pull gently back toward the difficulty of an "easy" first rating
  return clampD(w[7]! * initDifficulty(w, 4) + (1 - w[7]!) * damped);
}

function stabilityAfterRecall(w: readonly number[], d: number, s: number, r: number, g: Rating): number {
  const hard = g === 2 ? w[15]! : 1;
  const easy = g === 4 ? w[16]! : 1;
  return Math.max(s * (1 + Math.exp(w[8]!) * (11 - d) * Math.pow(s, -w[9]!) * (Math.exp((1 - r) * w[10]!) - 1) * hard * easy), MIN_STABILITY);
}

function stabilityAfterForget(w: readonly number[], d: number, s: number, r: number): number {
  const s2 = w[11]! * Math.pow(d, -w[12]!) * (Math.pow(s + 1, w[13]!) - 1) * Math.exp((1 - r) * w[14]!);
  return Math.max(Math.min(s2, s / Math.exp(w[17]! * w[18]!)), MIN_STABILITY);
}

/** Stability after a review on the same day as the previous one (FSRS-5 short-term rule). */
function stabilityShortTerm(w: readonly number[], s: number, g: Rating): number {
  const sinc = Math.exp(w[17]! * (g - 3 + w[18]!));
  return Math.max(s * (g >= 3 ? Math.max(sinc, 1) : sinc), MIN_STABILITY);
}

export interface ReviewResult {
  card: CardState;
  /** Scheduled days until due (0 when the card should be seen again within the session). */
  scheduledDays: number;
  /** Recall probability just before this review (null for a first review). */
  retrievability: number | null;
}

/** Apply one review. `now` is epoch milliseconds. */
export function review(card: CardState, rating: Rating, now: number, params: Params = DEFAULT_PARAMS): ReviewResult {
  const { w, desiredRetention } = params;
  const last = card.lastReview;
  const elapsedDays = last === null ? 0 : Math.max(0, (now - last) / DAY);
  let { stability: s, difficulty: d, state, lapses } = card;
  let r: number | null = null;
  let scheduledDays: number;

  if (state === State.New) {
    s = initStability(w, rating);
    d = initDifficulty(w, rating);
    if (rating <= 2) {
      state = State.Learning;
      scheduledDays = 0;
    } else {
      state = State.Review;
      scheduledDays = nextInterval(s, desiredRetention);
    }
  } else {
    r = retrievability(s, elapsedDays);
    if (elapsedDays < 1) {
      s = stabilityShortTerm(w, s, rating);
      d = nextDifficulty(w, d, rating);
    } else if (rating === 1) {
      s = stabilityAfterForget(w, d, s, r);
      d = nextDifficulty(w, d, rating);
    } else {
      s = stabilityAfterRecall(w, d, s, r, rating);
      d = nextDifficulty(w, d, rating);
    }
    const learning = card.state === State.Learning || card.state === State.Relearning;
    if (rating === 1) {
      if (card.state === State.Review) {
        lapses += 1;
        state = State.Relearning;
      }
      scheduledDays = 0;
    } else if (rating === 2 && learning) {
      scheduledDays = 0;
    } else {
      state = State.Review;
      scheduledDays = nextInterval(s, desiredRetention);
    }
  }

  // Cards still being learned come back in minutes; review cards in whole days.
  const due = scheduledDays === 0 ? now + (rating === 1 ? 60_000 : 10 * 60_000) : now + scheduledDays * DAY;
  return { card: { state, stability: s, difficulty: d, reps: card.reps + 1, lapses, lastReview: now, due }, scheduledDays, retrievability: r };
}

/** What each rating would schedule, for the buttons ("again 1m", "good 3d"). */
export function preview(card: CardState, now: number, params: Params = DEFAULT_PARAMS): Record<Rating, { due: number; scheduledDays: number }> {
  const out = {} as Record<Rating, { due: number; scheduledDays: number }>;
  for (const g of [1, 2, 3, 4] as Rating[]) {
    const r = review(card, g, now, params);
    out[g] = { due: r.card.due, scheduledDays: r.scheduledDays };
  }
  return out;
}
