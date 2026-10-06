import { describe, expect, it } from "vitest";
import { grade, officialProfiles, parseProfile, parseQuestion, scaleScore, seededRandom, type Question, type ScoringProfile } from "../src/index.js";

/** Random but repeatable exams: the same seed always builds the same questions and answers. */
function build(seed: string) {
  const rnd = seededRandom(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const questions: Question[] = [];
  const perfect: Record<string, unknown> = {};
  const wrong: Record<string, unknown> = {};
  const count = 5 + int(30);
  for (let i = 0; i < count; i++) {
    const id = `q${i}`;
    const base = { id, weight: 1 + int(4), domain: `d${int(3)}`, isPretest: rnd() < 0.1 };
    const options = ["a", "b", "c", "d", "e"].slice(0, 2 + int(4)).map((x) => ({ id: x, text: x }));
    const kind = int(3);
    if (kind === 0) {
      const correct = options[int(options.length)]!.id;
      questions.push(parseQuestion({ ...base, type: "mcq", payload: { options }, key: { correct } }));
      perfect[id] = { choice: correct };
      wrong[id] = { choice: options.find((o) => o.id !== correct)!.id };
    } else if (kind === 1) {
      const correct = options.filter(() => rnd() < 0.5).map((o) => o.id);
      if (!correct.length) correct.push(options[0]!.id);
      questions.push(parseQuestion({ ...base, type: "multi", payload: { options }, key: { correct } }));
      perfect[id] = { choices: correct };
      wrong[id] = { choices: options.filter((o) => !correct.includes(o.id)).map((o) => o.id) };
    } else {
      questions.push(parseQuestion({ ...base, type: "fib", payload: { blanks: 1 }, key: { blanks: [{ accepted: ["yes"] }] } }));
      perfect[id] = { blanks: ["yes"] };
      wrong[id] = { blanks: ["no"] };
    }
  }
  return { questions, perfect, wrong };
}

const profiles: ScoringProfile[] = [
  ...officialProfiles(),
  parseProfile({ name: "penalty", types: { multi: "penalty" }, negativeMarkingBp: 2500, floorAtZero: true, pass: { kind: "percent", minBp: 7000 } }),
  parseProfile({ name: "partial", types: { multi: "partial" }, rounding: "half_even", pass: { kind: "percent", minBp: 6500 } }),
];

describe("grading invariants", () => {
  for (const profile of profiles) {
    it(`${profile.name}: totals are consistent, bounded and repeatable`, () => {
      for (let s = 0; s < 40; s++) {
        const { questions, perfect, wrong } = build(`${profile.name}-${s}`);
        const rnd = seededRandom(`mix-${s}`);
        const mixed = Object.fromEntries(questions.map((q) => [q.id, rnd() < 0.3 ? undefined : rnd() < 0.5 ? perfect[q.id] : wrong[q.id]]).filter(([, v]) => v !== undefined));
        for (const responses of [perfect, wrong, mixed, {}]) {
          const r = grade(profile, questions, responses);
          expect(r.earned).toBeGreaterThanOrEqual(0);
          expect(r.earned).toBeLessThanOrEqual(r.max);
          expect(r.rawBp).toBeGreaterThanOrEqual(0);
          expect(r.rawBp).toBeLessThanOrEqual(10_000);
          const sum = r.items.reduce((a, i) => a + i.earned, 0);
          expect(profile.floorAtZero ? Math.max(0, sum) : sum).toBe(r.earned);
          expect(r.items.reduce((a, i) => a + i.max, 0)).toBe(r.max);
          expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(questions.length);
          // Same inputs, same answer, whatever order the responses were stored in.
          const shuffled = Object.fromEntries(Object.entries(responses).reverse());
          expect(grade(profile, questions, shuffled)).toEqual(r);
          if (r.scaled !== null && profile.scale) {
            expect(r.scaled).toBeGreaterThanOrEqual(profile.scale.min);
            expect(r.scaled).toBeLessThanOrEqual(profile.scale.max);
          }
        }
        const best = grade(profile, questions, perfect);
        if (best.max > 0) expect(best.rawBp).toBe(10_000);
        expect(grade(profile, questions, {}).earned).toBe(0);
      }
    });
  }

  it("a better answer sheet never scores lower (single choice and fill in)", () => {
    const profile = parseProfile({ name: "plain", pass: { kind: "percent", minBp: 5000 } });
    const { questions, perfect, wrong } = build("monotone");
    let sheet: Record<string, unknown> = { ...wrong };
    let last = grade(profile, questions, sheet).earned;
    for (const q of questions) {
      sheet = { ...sheet, [q.id]: perfect[q.id] };
      const now = grade(profile, questions, sheet).earned;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it("scaled scores never decrease as the raw score rises", () => {
    for (const profile of officialProfiles().filter((p) => p.scale)) {
      let prev = -Infinity;
      for (let bp = 0; bp <= 10_000; bp += 7) {
        const v = scaleScore(profile, bp)!;
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });
});
