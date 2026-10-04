import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, DEFAULT_W, State, newCard, nextInterval, preview, retrievability, review, type CardState, type Rating } from "../src/index.js";

const T0 = Date.UTC(2026, 9, 4, 12);
const DAY = 86_400_000;

describe("core formulas", () => {
  it("recall probability is 90% when the elapsed time equals the stability", () => {
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 10);
    expect(retrievability(5, 0)).toBe(1);
    expect(retrievability(5, -3)).toBe(1);
  });
  it("the interval for 90% retention equals the stability, and longer for lower retention", () => {
    expect(nextInterval(10, 0.9)).toBe(10);
    expect(nextInterval(3.173, 0.9)).toBe(3);
    expect(nextInterval(10, 0.8)).toBeGreaterThan(10);
    expect(nextInterval(10, 0.97)).toBeLessThan(10);
    expect(nextInterval(0.001, 0.9)).toBe(1);
    expect(nextInterval(1e9, 0.9)).toBe(36_500);
  });
});

describe("first review", () => {
  it("seeds stability and difficulty from the weights", () => {
    const good = review(newCard(T0), 3, T0);
    expect(good.card.stability).toBe(DEFAULT_W[2]);
    expect(good.card.difficulty).toBeCloseTo(DEFAULT_W[4]! - Math.exp(DEFAULT_W[5]! * 2) + 1, 10);
    expect(good.card).toMatchObject({ state: State.Review, reps: 1, lapses: 0, lastReview: T0 });
    expect(good.scheduledDays).toBe(3);
    expect(good.card.due).toBe(T0 + 3 * DAY);
    expect(good.retrievability).toBeNull();
  });
  it("again and hard keep a new card in learning, due in minutes", () => {
    const again = review(newCard(T0), 1, T0);
    const hard = review(newCard(T0), 2, T0);
    expect([again.card.state, hard.card.state]).toEqual([State.Learning, State.Learning]);
    expect(again.card.due).toBe(T0 + 60_000);
    expect(hard.card.due).toBe(T0 + 600_000);
    expect(review(newCard(T0), 4, T0).scheduledDays).toBeGreaterThan(review(newCard(T0), 3, T0).scheduledDays);
  });
});

function grow(ratings: Rating[]): { card: CardState; days: number[] } {
  let card = newCard(T0);
  let now = T0;
  const days: number[] = [];
  for (const g of ratings) {
    const r = review(card, g, now);
    card = r.card;
    days.push(r.scheduledDays);
    now = card.due;
  }
  return { card, days };
}

describe("later reviews", () => {
  it("intervals grow with each successful review at the due date", () => {
    const { days } = grow([3, 3, 3, 3, 3, 3]);
    for (let i = 1; i < days.length; i++) expect(days[i]!).toBeGreaterThan(days[i - 1]!);
  });
  it("easy beats good beats hard on the same history", () => {
    const base = grow([3, 3]).card;
    const at = base.due;
    const d = (g: Rating) => review(base, g, at).scheduledDays;
    expect(d(4)).toBeGreaterThan(d(3));
    expect(d(3)).toBeGreaterThan(d(2));
  });
  it("forgetting counts a lapse, drops stability, and relearns", () => {
    const base = grow([3, 3, 3]).card;
    const r = review(base, 1, base.due);
    expect(r.card.state).toBe(State.Relearning);
    expect(r.card.lapses).toBe(1);
    expect(r.card.stability).toBeLessThan(base.stability);
    expect(r.card.due).toBe(base.due + 60_000);
    expect(r.retrievability).toBeLessThan(1);
    const recovered = review(r.card, 3, r.card.due);
    expect(recovered.card.state).toBe(State.Review);
    expect(recovered.card.lapses).toBe(1);
  });
  it("a hard answer while relearning stays in relearning, and a second miss is not a second lapse", () => {
    const base = grow([3, 3]).card;
    const lapsed = review(base, 1, base.due).card;
    const hard = review(lapsed, 2, lapsed.due);
    expect(hard.card.state).toBe(State.Relearning);
    expect(hard.scheduledDays).toBe(0);
    expect(review(lapsed, 1, lapsed.due).card.lapses).toBe(1);
  });
  it("learning cards graduate on good, and hard keeps them learning", () => {
    const learning = review(newCard(T0), 1, T0).card;
    expect(review(learning, 2, learning.due).card.state).toBe(State.Learning);
    const grad = review(learning, 3, learning.due);
    expect(grad.card.state).toBe(State.Review);
    expect(grad.scheduledDays).toBeGreaterThanOrEqual(1);
  });
  it("same-day reviews use the short-term rule", () => {
    const first = review(newCard(T0), 3, T0).card;
    const again = review(first, 3, T0 + 60_000);
    expect(again.card.stability).toBeGreaterThanOrEqual(first.stability);
    expect(review(first, 1, T0 + 60_000).card.stability).toBeLessThan(first.stability);
  });
  it("reviewing early earns less growth than reviewing late", () => {
    const base = grow([3, 3]).card;
    const early = review(base, 3, base.lastReview! + 1 * DAY).card.stability;
    const onTime = review(base, 3, base.due).card.stability;
    const late = review(base, 3, base.due + 20 * DAY).card.stability;
    expect(early).toBeLessThan(onTime);
    expect(onTime).toBeLessThan(late);
  });
  it("a higher desired retention shortens intervals", () => {
    const base = grow([3, 3]).card;
    const lo = review(base, 3, base.due, { ...DEFAULT_PARAMS, desiredRetention: 0.8 }).scheduledDays;
    const hi = review(base, 3, base.due, { ...DEFAULT_PARAMS, desiredRetention: 0.95 }).scheduledDays;
    expect(hi).toBeLessThan(lo);
  });
});

describe("properties", () => {
  it("difficulty stays within 1 to 10, stability stays positive, and results are repeatable, whatever the answers", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let run = 0; run < 200; run++) {
      let card = newCard(T0);
      let now = T0;
      for (let i = 0; i < 40; i++) {
        const g = (1 + Math.floor(rnd() * 4)) as Rating;
        now += Math.floor(rnd() * 40 * DAY);
        const a = review(card, g, now);
        expect(review(card, g, now)).toEqual(a);
        card = a.card;
        expect(card.difficulty).toBeGreaterThanOrEqual(1);
        expect(card.difficulty).toBeLessThanOrEqual(10);
        expect(card.stability).toBeGreaterThan(0);
        expect(Number.isFinite(card.stability)).toBe(true);
        expect(card.due).toBeGreaterThan(now);
      }
    }
  });
  it("answering good never lowers stability at or after the due date", () => {
    const { card } = grow([3, 3, 3]);
    for (const extra of [0, 1, 5, 30]) expect(review(card, 3, card.due + extra * DAY).card.stability).toBeGreaterThanOrEqual(card.stability);
  });
  it("preview matches the real review for every rating", () => {
    const { card } = grow([3, 3]);
    const p = preview(card, card.due);
    for (const g of [1, 2, 3, 4] as Rating[]) {
      const r = review(card, g, card.due);
      expect(p[g]).toEqual({ due: r.card.due, scheduledDays: r.scheduledDays });
    }
    expect(Object.keys(preview(newCard(T0), T0))).toEqual(["1", "2", "3", "4"]);
  });
});
