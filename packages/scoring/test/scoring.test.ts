import { describe, expect, it } from "vitest";
import golden from "./golden.json" with { type: "json" };
import {
  OFFICIAL_PROFILES,
  canonicalJson,
  divRound,
  grade,
  normalizeText,
  officialProfiles,
  parseProfile,
  parseQuestion,
  presentQuestion,
  publicQuestion,
  questionProblems,
  scaleScore,
  selectQuestions,
  seededRandom,
  shuffle,
  unsafeRegex,
  type Question,
} from "../src/index.js";

describe("golden vectors", () => {
  for (const v of golden.vectors) {
    it(v.name, () => {
      const profile = parseProfile(v.profile);
      const qs = v.questions.map((q) => parseQuestion(q));
      const r = grade(profile, qs, v.responses);
      expect(r.earned).toBe(v.expected.earned);
      expect(r.max).toBe(v.expected.max);
      expect(r.rawBp).toBe(v.expected.rawBp);
      expect(r.scaled).toBe(v.expected.scaled);
      expect(r.pass).toBe(v.expected.pass);
      for (const [id, [earned, outcome]] of Object.entries(v.expected.items as unknown as Record<string, [number, string]>)) {
        const it = r.items.find((i) => i.id === id)!;
        expect([id, it.earned, it.outcome]).toEqual([id, earned, outcome]);
      }
    });
  }
});

describe("divRound", () => {
  it("rounds per mode, including negatives and exact halves", () => {
    expect(divRound(5, 2, "half_up")).toBe(3);
    expect(divRound(5, 2, "floor")).toBe(2);
    expect(divRound(5, 2, "half_even")).toBe(2);
    expect(divRound(7, 2, "half_even")).toBe(4);
    expect(divRound(7, 3, "half_even")).toBe(2);
    expect(divRound(8, 3, "half_even")).toBe(3);
    expect(divRound(-5, 2, "half_up")).toBe(-2);
    expect(divRound(-5, 2, "floor")).toBe(-3);
    expect(divRound(-5, 2, "half_even")).toBe(-2);
    expect(divRound(6, 3, "half_up")).toBe(2);
  });
  it("rejects bad input", () => {
    expect(() => divRound(1.5, 2, "floor")).toThrow();
    expect(() => divRound(1, 0, "floor")).toThrow();
  });
});

const mcq = (id: string, over: Partial<Question> = {}) =>
  parseQuestion({ id, type: "mcq", payload: { options: [{ id: "a", text: "" }, { id: "b", text: "" }] }, key: { correct: "a" }, ...over });
const base = { name: "p", pass: { kind: "percent", minBp: 5000 } } as const;

describe("question types", () => {
  it("mcq: blank and malformed answers are unanswered", () => {
    const p = parseProfile(base);
    for (const bad of [undefined, null, {}, { choice: "" }, { choice: 3 }, "a"]) {
      expect(grade(p, [mcq("1")], { "1": bad }).items[0]!.outcome).toBe("unanswered");
    }
  });
  it("multi: all three modes", () => {
    const q = parseQuestion({ id: "m", type: "multi", payload: { options: ["a", "b", "c", "d"].map((x) => ({ id: x, text: "" })) }, key: { correct: ["a", "b"] } });
    const run = (mode: string, choices: string[]) =>
      grade(parseProfile({ ...base, types: { multi: mode } }), [q], { m: { choices } }).items[0]!.earned;
    expect(run("all_or_nothing", ["a", "b"])).toBe(1000);
    expect(run("all_or_nothing", ["a"])).toBe(0);
    expect(run("partial", ["a"])).toBe(500);
    expect(run("partial", ["a", "c"])).toBe(0);
    expect(run("penalty", ["a", "c"])).toBe(0);
    expect(run("penalty", ["a", "b", "c"])).toBe(500);
    expect(grade(parseProfile(base), [q], { m: { choices: [] } }).items[0]!.outcome).toBe("unanswered");
    expect(grade(parseProfile(base), [q], { m: { choices: "a" } }).items[0]!.outcome).toBe("unanswered");
  });
  it("fib: normalisation, case, numeric tolerance, regex, all-or-nothing", () => {
    const q = parseQuestion({
      id: "f",
      type: "fib",
      payload: { blanks: 4 },
      key: {
        blanks: [
          { accepted: ["Port  80"], caseSensitive: false },
          { accepted: ["SSH"], caseSensitive: true },
          { numeric: { value: 3.14, tolerance: 0.01 } },
          { regex: "^10\\.0\\.\\d+\\.\\d+$" },
        ],
      },
    });
    const run = (blanks: unknown[], mode = "per_blank") => grade(parseProfile({ ...base, types: { fib: mode } }), [q], { f: { blanks } }).items[0]!;
    expect(run([" port 80 ", "SSH", "3.145", "10.0.4.5"]).outcome).toBe("correct");
    expect(run(["port 80", "ssh", "3,14", "10.1.4.5"]).earned).toBe(250);
    expect(run(["port 80", "SSH", "abc", "x"], "all_or_nothing").earned).toBe(0);
    expect(run(["x".repeat(300), "", "1e1", "10.0.1.1"]).detail.blanks).toEqual([false, false, false, true]);
    expect(run(["", "  ", null, undefined]).outcome).toBe("unanswered");
    expect(grade(parseProfile(base), [q], { f: { blanks: "no" } }).items[0]!.outcome).toBe("unanswered");
  });
  it("dnd: per item, all-or-nothing, missing items", () => {
    const q = parseQuestion({
      id: "d",
      type: "dnd",
      payload: { items: [{ id: "x", text: "" }, { id: "y", text: "" }], targets: [{ id: "t", text: "" }] },
      key: { mapping: { x: "t", y: "t" } },
    });
    const g = (mode: string, mapping: unknown) => grade(parseProfile({ ...base, types: { dnd: mode } }), [q], { d: { mapping } }).items[0]!;
    expect(g("per_item", { x: "t" }).earned).toBe(500);
    expect(g("all_or_nothing", { x: "t" }).earned).toBe(0);
    expect(g("all_or_nothing", { x: "t", y: "t" }).outcome).toBe("correct");
    expect(g("per_item", {}).outcome).toBe("unanswered");
    expect(grade(parseProfile(base), [q], { d: { mapping: [] } }).items[0]!.outcome).toBe("unanswered");
  });
  it("pbq: every operator, safe paths, all-or-nothing", () => {
    const q = parseQuestion({
      id: "p",
      type: "pbq",
      payload: {},
      key: {
        assertions: [
          { id: "1", path: "a.b", op: "eq", value: 1 },
          { id: "2", path: "a.c", op: "neq", value: "x" },
          { id: "3", path: "a.list", op: "contains", value: "z" },
          { id: "4", path: "a.s", op: "contains", value: "ell" },
          { id: "5", path: "a.n", op: "gte", value: 5 },
          { id: "6", path: "a.n", op: "lte", value: 9 },
          { id: "7", path: "a.s", op: "matches", value: "^h" },
          { id: "8", path: "a.list.1", op: "eq", value: "z" },
          { id: "9", path: "a.missing", op: "neq", value: 1 },
        ],
      },
    });
    const state = { a: { b: 1, c: "y", list: ["q", "z"], s: "hello", n: 7 } };
    const r = grade(parseProfile(base), [q], { p: { state } }).items[0]!;
    expect(r.detail.assertions).toEqual({ "1": true, "2": true, "3": true, "4": true, "5": true, "6": true, "7": true, "8": true, "9": false });
    expect(grade(parseProfile({ ...base, types: { pbq: "all_or_nothing" } }), [q], { p: { state } }).items[0]!.earned).toBe(0);
    const proto = grade(parseProfile(base), [q], { p: { state: { a: {} } } }).items[0]!;
    expect(proto.outcome).toBe("incorrect");
    expect(grade(parseProfile(base), [q], { p: {} }).items[0]!.outcome).toBe("unanswered");
    expect(grade(parseProfile(base), [q], { p: { state: "x" } }).items[0]!.outcome).toBe("incorrect");
  });
  it("pbq ignores prototype tricks and never throws on bad patterns", () => {
    const q = parseQuestion({ id: "p", type: "pbq", payload: {}, key: { assertions: [{ id: "1", path: "__proto__.polluted", op: "eq", value: true }, { id: "2", path: "a", op: "matches", value: "(" }] } });
    expect(grade(parseProfile(base), [q], { p: { state: { a: "x" } } }).items[0]!.earned).toBe(0);
  });
});

describe("profiles and scaling", () => {
  it("validates scale shape and pass rule", () => {
    const bad = (x: object) => expect(() => parseProfile({ ...base, ...x })).toThrow();
    bad({ pass: { kind: "scaled", min: 5 } });
    bad({ scale: { min: 0, max: 10, points: [{ rawBp: 0, scaled: 0 }, { rawBp: 9000, scaled: 10 }] } });
    bad({ scale: { min: 0, max: 10, points: [{ rawBp: 0, scaled: 5 }, { rawBp: 5000, scaled: 3 }, { rawBp: 10000, scaled: 10 }] } });
    bad({ scale: { min: 0, max: 10, points: [{ rawBp: 0, scaled: 0 }, { rawBp: 0, scaled: 1 }, { rawBp: 10000, scaled: 10 }] } });
    bad({ scale: { min: 10, max: 0, points: [{ rawBp: 0, scaled: 5 }, { rawBp: 10000, scaled: 5 }] } });
    bad({ scale: { min: 0, max: 10, points: [{ rawBp: 0, scaled: 0 }, { rawBp: 10000, scaled: 11 }] } });
  });
  it("piecewise scale hits every vertex and interpolates between", () => {
    const p = parseProfile({
      ...base,
      scale: { min: 0, max: 1000, points: [{ rawBp: 0, scaled: 0 }, { rawBp: 5000, scaled: 700 }, { rawBp: 10000, scaled: 1000 }] },
    });
    expect([0, 2500, 5000, 7500, 10000].map((x) => scaleScore(p, x))).toEqual([0, 350, 700, 850, 1000]);
    expect(scaleScore(parseProfile(base), 5000)).toBeNull();
  });
  it("official profiles all parse and are honest about fidelity", () => {
    expect(officialProfiles()).toHaveLength(OFFICIAL_PROFILES.length);
    for (const p of officialProfiles()) expect(p.source).toBeTruthy();
    expect(officialProfiles().find((p) => p.scale)!.fidelity).toBe("community_estimate");
  });
  it("canonicalJson is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: undefined }] })).toBe(canonicalJson({ a: [{ d: 1 }], b: 1 }));
    expect(canonicalJson(null)).toBe("null");
  });
  it("an empty exam fails rather than dividing by zero", () => {
    const r = grade(parseProfile(base), [], {});
    expect([r.max, r.rawBp, r.pass]).toEqual([0, 0, false]);
  });
  it("pretest questions score when the profile says so", () => {
    const q = mcq("x", { isPretest: true });
    expect(grade(parseProfile({ ...base, excludePretest: false }), [q], { x: { choice: "a" } }).max).toBe(1000);
  });
  it("negative totals are kept when floorAtZero is off", () => {
    const r = grade(parseProfile({ ...base, floorAtZero: false, negativeMarkingBp: 5000 }), [mcq("x")], { x: { choice: "b" } });
    expect(r.earned).toBe(-500);
    expect(r.rawBp).toBe(0);
  });
});

describe("question validation", () => {
  const ok = { id: "q", type: "multi", payload: { options: ["a", "b", "c"].map((x) => ({ id: x, text: "" })), select: 2 }, key: { correct: ["a", "b"] } };
  it("accepts good questions and flags bad ones", () => {
    expect(questionProblems(parseQuestion(ok))).toEqual([]);
    expect(questionProblems(parseQuestion({ ...ok, key: { correct: ["a", "z"] } }))).toContain("correct answer z is not an option");
    expect(questionProblems(parseQuestion({ ...ok, payload: { ...ok.payload, select: 1 } }))).toContain("select must equal the number of correct answers");
    expect(questionProblems(parseQuestion({ ...ok, key: { correct: ["a", "b", "c"] }, payload: { options: ok.payload.options } }))).toContain("at least one option must be wrong");
    expect(questionProblems(parseQuestion({ ...ok, key: { correct: ["a", "a"] } }))).toContain("correct answers must be unique");
    expect(questionProblems(parseQuestion({ id: "q", type: "mcq", payload: { options: [{ id: "a", text: "" }, { id: "a", text: "" }] }, key: { correct: "a" } }))).toContain("option ids must be unique");
    expect(questionProblems(parseQuestion({ id: "f", type: "fib", payload: { blanks: 2 }, key: { blanks: [{ accepted: ["x"] }] } }))).toContain("key must describe every blank");
    expect(questionProblems(parseQuestion({ id: "f", type: "fib", payload: { blanks: 1 }, key: { blanks: [{}] } }))).toContain("blank 1 has no accepted answer");
    expect(questionProblems(parseQuestion({ id: "f", type: "fib", payload: { blanks: 1 }, key: { blanks: [{ regex: "(a+)+$" }] } }))).toContain("blank 1 has an unsafe pattern");
    const d = { id: "d", type: "dnd", payload: { items: [{ id: "i", text: "" }], targets: [{ id: "t", text: "" }] }, key: { mapping: { i: "t" } } };
    expect(questionProblems(parseQuestion(d))).toEqual([]);
    expect(questionProblems(parseQuestion({ ...d, key: { mapping: { x: "t" } } }))).toEqual(["item i has no target in the key", "key mentions unknown item x"]);
    expect(questionProblems(parseQuestion({ ...d, key: { mapping: { i: "zz" } } }))).toEqual(["key mentions unknown target zz"]);
    expect(questionProblems(parseQuestion({ ...d, payload: { items: [{ id: "i", text: "" }, { id: "i", text: "" }], targets: [{ id: "t", text: "" }] } }))).toContain("item and target ids must be unique");
    const pbq = { id: "p", type: "pbq", payload: {}, key: { assertions: [{ id: "1", path: "a", op: "matches", value: "(a+)+" }, { id: "1", path: "b", op: "eq", value: 1 }] } };
    expect(questionProblems(parseQuestion(pbq))).toEqual(["assertion ids must be unique", "assertion 1 has an unsafe or non-text pattern"]);
  });
  it("schema rejects unknown types and missing keys", () => {
    expect(() => parseQuestion({ id: "x", type: "essay", payload: {}, key: {} })).toThrow();
    expect(() => parseQuestion({ id: "x", type: "mcq", payload: { options: [{ id: "a", text: "" }, { id: "b", text: "" }] } })).toThrow();
  });
  it("unsafeRegex catches nested quantifiers, backrefs, junk and long patterns", () => {
    expect(unsafeRegex("(a+)+")).toBe(true);
    expect(unsafeRegex("(\\w*)*")).toBe(true);
    expect(unsafeRegex("(a)\\1")).toBe(true);
    expect(unsafeRegex("(")).toBe(true);
    expect(unsafeRegex("a".repeat(101))).toBe(true);
    expect(unsafeRegex("^\\d{1,3}(\\.\\d{1,3}){3}$")).toBe(false);
  });
  it("publicQuestion drops the key", () => {
    expect(publicQuestion(mcq("1"))).not.toHaveProperty("key");
  });
  it("normalizeText", () => {
    expect(normalizeText("  Ab\t c ")).toBe("ab c");
    expect(normalizeText("  Ab  ", true)).toBe("Ab");
  });
});

describe("presentation", () => {
  const pool = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}` }));
  it("is deterministic per seed and differs across seeds", () => {
    const a = selectQuestions(pool, { count: 10, shuffle: true, seed: "s1" }).map((q) => q.id);
    expect(selectQuestions(pool, { count: 10, shuffle: true, seed: "s1" }).map((q) => q.id)).toEqual(a);
    expect(selectQuestions(pool, { count: 10, shuffle: true, seed: "s2" }).map((q) => q.id)).not.toEqual(a);
    expect(a).toHaveLength(10);
    expect(selectQuestions(pool, { shuffle: false, seed: "s" })).toEqual(pool);
  });
  it("shuffles options without losing any and never leaks the key", () => {
    const q = parseQuestion({ id: "m", type: "mcq", payload: { options: ["a", "b", "c", "d", "e"].map((x) => ({ id: x, text: x })) }, key: { correct: "a" } });
    const v = presentQuestion(q, "seed", true) as any;
    expect(v).not.toHaveProperty("key");
    expect(v.payload.options.map((o: any) => o.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(presentQuestion(q, "seed", true)).toEqual(v);
    expect(presentQuestion(q, "seed", false)).not.toHaveProperty("key");
    const d = parseQuestion({ id: "d", type: "dnd", payload: { items: [{ id: "1", text: "" }, { id: "2", text: "" }, { id: "3", text: "" }], targets: [{ id: "t", text: "" }] }, key: { mapping: { 1: "t", 2: "t", 3: "t" } } });
    expect((presentQuestion(d, "x", true) as any).payload.targets).toHaveLength(1);
    const f = parseQuestion({ id: "f", type: "fib", payload: { blanks: 1 }, key: { blanks: [{ accepted: ["x"] }] } });
    expect(presentQuestion(f, "x", true)).not.toHaveProperty("key");
  });
  it("seededRandom stays in [0,1) and shuffle is a permutation", () => {
    const r = seededRandom("abc");
    for (let i = 0; i < 1000; i++) {
      const n = r();
      expect(n >= 0 && n < 1).toBe(true);
    }
    expect(shuffle([1, 2, 3, 4, 5], seededRandom("z")).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("properties", () => {
  const rnd = seededRandom("property-tests");
  const options = ["a", "b", "c", "d"].map((x) => ({ id: x, text: "" }));
  const pool = Array.from({ length: 12 }, (_, i) =>
    i % 2
      ? parseQuestion({ id: `q${i}`, weight: 1 + (i % 3), domain: i % 4 ? "A" : "B", type: "multi", payload: { options }, key: { correct: ["a", "b"] } })
      : parseQuestion({ id: `q${i}`, weight: 1 + (i % 3), domain: i % 4 ? "A" : "B", type: "mcq", payload: { options }, key: { correct: "a" } }),
  );
  const randomResponses = () =>
    Object.fromEntries(pool.map((q) => [q.id, q.type === "mcq" ? { choice: options[Math.floor(rnd() * 4)]!.id } : { choices: options.filter(() => rnd() > 0.5).map((o) => o.id) }]));
  const profile = parseProfile({
    name: "p",
    types: { multi: "penalty" },
    negativeMarkingBp: 1000,
    scale: { min: 100, max: 900, points: [{ rawBp: 0, scaled: 100 }, { rawBp: 6000, scaled: 600 }, { rawBp: 10000, scaled: 900 }] },
    pass: { kind: "scaled", min: 600 },
  });

  it("scores stay within bounds, are integers, and grading is repeatable", () => {
    for (let n = 0; n < 300; n++) {
      const r = randomResponses();
      const g = grade(profile, pool, r);
      expect(g).toEqual(grade(profile, pool, r));
      expect(Number.isInteger(g.earned)).toBe(true);
      expect(g.earned).toBeGreaterThanOrEqual(0);
      expect(g.earned).toBeLessThanOrEqual(g.max);
      expect(g.rawBp).toBeGreaterThanOrEqual(0);
      expect(g.rawBp).toBeLessThanOrEqual(10_000);
      expect(g.scaled!).toBeGreaterThanOrEqual(100);
      expect(g.scaled!).toBeLessThanOrEqual(900);
    }
  });
  it("scaling is monotone in the raw score", () => {
    let last = -Infinity;
    for (let bp = 0; bp <= 10_000; bp += 7) {
      const s = scaleScore(profile, bp)!;
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
  it("making one answer correct never lowers the score (no negative marking)", () => {
    const p = parseProfile({ name: "p", types: { multi: "partial" }, pass: { kind: "percent", minBp: 5000 } });
    for (let n = 0; n < 200; n++) {
      const r = randomResponses();
      const before = grade(p, pool, r).earned;
      const q = pool[Math.floor(rnd() * pool.length)]!;
      const fixed = { ...r, [q.id]: q.type === "mcq" ? { choice: "a" } : { choices: ["a", "b"] } };
      expect(grade(p, pool, fixed).earned).toBeGreaterThanOrEqual(before);
    }
  });
  it("answering everything correctly always earns the maximum", () => {
    const all = Object.fromEntries(pool.map((q) => [q.id, q.type === "mcq" ? { choice: "a" } : { choices: ["a", "b"] }]));
    const g = grade(profile, pool, all);
    expect([g.earned, g.rawBp, g.scaled, g.pass]).toEqual([g.max, 10_000, 900, true]);
  });
});
