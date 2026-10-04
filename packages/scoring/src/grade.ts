import { divRound, frac, type Frac } from "./math.js";
import { POINTS_PER_WEIGHT, type Question } from "./questions.js";
import type { ScoringProfile } from "./profile.js";

export type Outcome = "correct" | "partial" | "incorrect" | "unanswered" | "excluded";

export interface ItemResult {
  id: string;
  outcome: Outcome;
  /** Milli-points earned and available (a weight-1 question is worth 1000). */
  earned: number;
  max: number;
  detail: Record<string, unknown>;
}
export interface DomainResult {
  domain: string;
  earned: number;
  max: number;
  bp: number;
  met: boolean | null;
}
export interface GradeResult {
  earned: number;
  max: number;
  /** Raw score in basis points (10000 = 100%). */
  rawBp: number;
  scaled: number | null;
  pass: boolean;
  domains: DomainResult[];
  items: ItemResult[];
  counts: Record<Outcome, number>;
}

export type Responses = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strs = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null);

/** Collapse whitespace and Unicode form so visually equal answers compare equal. */
export function normalizeText(s: string, caseSensitive = false): string {
  const t = s.normalize("NFC").trim().replace(/\s+/g, " ");
  return caseSensitive ? t : t.toLowerCase();
}

function blankMatches(key: Extract<Question, { type: "fib" }>["key"]["blanks"][number], raw: string): boolean {
  if (raw.length > 200) return false;
  const given = normalizeText(raw, key.caseSensitive);
  if (key.accepted.some((a) => normalizeText(a, key.caseSensitive) === given)) return true;
  if (key.numeric) {
    const cleaned = given.replace(/,/g, "");
    if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/.test(cleaned)) {
      const n = Number(cleaned);
      if (Number.isFinite(n) && Math.abs(n - key.numeric.value) <= key.numeric.tolerance) return true;
    }
  }
  if (key.regex) {
    try {
      if (new RegExp(key.regex, key.caseSensitive ? "" : "i").test(raw.trim())) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function pathGet(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split(".")) {
    if (Array.isArray(cur)) cur = /^\d+$/.test(part) ? cur[Number(part)] : undefined;
    else if (isObj(cur) && Object.hasOwn(cur, part)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

function assertionPasses(a: { op: string; value?: unknown }, actual: unknown): boolean {
  switch (a.op) {
    case "eq":
      return JSON.stringify(actual) === JSON.stringify(a.value);
    case "neq":
      return actual !== undefined && JSON.stringify(actual) !== JSON.stringify(a.value);
    case "in":
      return Array.isArray(a.value) && a.value.some((v) => JSON.stringify(v) === JSON.stringify(actual));
    case "contains":
      if (typeof actual === "string") return typeof a.value === "string" && actual.includes(a.value);
      return Array.isArray(actual) && actual.some((v) => JSON.stringify(v) === JSON.stringify(a.value));
    case "gte":
      return typeof actual === "number" && typeof a.value === "number" && actual >= a.value;
    case "lte":
      return typeof actual === "number" && typeof a.value === "number" && actual <= a.value;
    case "matches":
      return typeof actual === "string" && actual.length <= 500 && typeof a.value === "string" && new RegExp(a.value).test(actual);
    default:
      return false;
  }
}

interface Graded {
  frac: Frac | null; // null = unanswered
  detail: Record<string, unknown>;
}

function gradeOne(q: Question, response: unknown, p: ScoringProfile): Graded {
  if (response === undefined || response === null) return { frac: null, detail: {} };
  switch (q.type) {
    case "mcq": {
      const choice = isObj(response) ? response.choice : undefined;
      if (typeof choice !== "string" || choice === "") return { frac: null, detail: {} };
      const ok = choice === q.key.correct;
      return { frac: ok ? frac(1, 1) : frac(-p.negativeMarkingBp, 10_000), detail: { correct: ok } };
    }
    case "multi": {
      const choices = isObj(response) ? strs(response.choices) : null;
      if (!choices || choices.length === 0) return { frac: null, detail: {} };
      const sel = new Set(choices);
      const k = q.key.correct.length;
      const right = q.key.correct.filter((c) => sel.has(c)).length;
      const wrong = [...sel].filter((c) => !q.key.correct.includes(c)).length;
      const mode = p.types.multi;
      let f: Frac;
      if (mode === "all_or_nothing") f = frac(right === k && wrong === 0 ? 1 : 0, 1);
      else if (mode === "partial") f = frac(wrong === 0 ? right : 0, k);
      else f = frac(Math.max(0, right - wrong), k);
      return { frac: f, detail: { right, wrong, of: k } };
    }
    case "fib": {
      const given = isObj(response) ? response.blanks : null;
      if (!Array.isArray(given) || given.every((g) => g === null || g === undefined || String(g).trim() === "")) return { frac: null, detail: {} };
      const results = q.key.blanks.map((b, i) => typeof given[i] === "string" && blankMatches(b, given[i] as string));
      const right = results.filter(Boolean).length;
      const n = results.length;
      return { frac: p.types.fib === "all_or_nothing" ? frac(right === n ? 1 : 0, 1) : frac(right, n), detail: { blanks: results } };
    }
    case "dnd": {
      const m = isObj(response) && isObj(response.mapping) ? (response.mapping as Record<string, unknown>) : null;
      if (!m || Object.keys(m).length === 0) return { frac: null, detail: {} };
      const entries = Object.entries(q.key.mapping);
      const results: Record<string, boolean> = {};
      for (const [item, target] of entries) results[item] = m[item] === target;
      const right = Object.values(results).filter(Boolean).length;
      return { frac: p.types.dnd === "all_or_nothing" ? frac(right === entries.length ? 1 : 0, 1) : frac(right, entries.length), detail: { items: results } };
    }
    case "pbq": {
      const state = isObj(response) ? response.state : undefined;
      if (state === undefined || state === null) return { frac: null, detail: {} };
      const results: Record<string, boolean> = {};
      let gained = 0;
      let total = 0;
      for (const a of q.key.assertions) {
        let ok = false;
        try {
          ok = assertionPasses(a, pathGet(state, a.path));
        } catch {
          ok = false;
        }
        results[a.id] = ok;
        total += a.weight;
        if (ok) gained += a.weight;
      }
      return { frac: p.types.pbq === "all_or_nothing" ? frac(gained === total ? 1 : 0, 1) : frac(gained, total), detail: { assertions: results } };
    }
  }
}

/** Piecewise-linear scaled score for a raw score in basis points. Integer maths only. */
export function scaleScore(p: ScoringProfile, rawBp: number): number | null {
  const s = p.scale;
  if (!s) return null;
  const pts = s.points;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (rawBp <= b.rawBp) return a.scaled + divRound((b.scaled - a.scaled) * (rawBp - a.rawBp), b.rawBp - a.rawBp, p.rounding);
  }
  return pts[pts.length - 1]!.scaled;
}

/**
 * Grade a set of responses. Pure and deterministic: no clock, no randomness, no I/O.
 * Every question is worth `weight * 1000` milli-points; partial credit is rounded once per
 * question using the profile's rounding rule, so totals are exact integers.
 */
export function grade(profile: ScoringProfile, questions: Question[], responses: Responses): GradeResult {
  const items: ItemResult[] = [];
  const counts: Record<Outcome, number> = { correct: 0, partial: 0, incorrect: 0, unanswered: 0, excluded: 0 };
  const byDomain = new Map<string, { earned: number; max: number }>();
  let earned = 0;
  let max = 0;

  for (const q of questions) {
    const qmax = q.weight * POINTS_PER_WEIGHT;
    if (q.isPretest && profile.excludePretest) {
      items.push({ id: q.id, outcome: "excluded", earned: 0, max: 0, detail: {} });
      counts.excluded++;
      continue;
    }
    const g = gradeOne(q, Object.hasOwn(responses, q.id) ? responses[q.id] : undefined, profile);
    let e = 0;
    let outcome: Outcome = "unanswered";
    if (g.frac) {
      e = divRound(qmax * g.frac.num, g.frac.den, profile.rounding);
      outcome = e >= qmax ? "correct" : e > 0 ? "partial" : "incorrect";
    }
    items.push({ id: q.id, outcome, earned: e, max: qmax, detail: g.detail });
    counts[outcome]++;
    earned += e;
    max += qmax;
    const dom = q.domain ?? "General";
    const d = byDomain.get(dom) ?? { earned: 0, max: 0 };
    d.earned += e;
    d.max += qmax;
    byDomain.set(dom, d);
  }

  if (profile.floorAtZero) earned = Math.max(0, earned);
  const rawBp = max === 0 ? 0 : Math.min(10_000, Math.max(0, divRound(earned * 10_000, max, profile.rounding)));
  const scaled = scaleScore(profile, rawBp);

  const domains: DomainResult[] = [...byDomain.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, d]) => {
      const bp = d.max === 0 ? 0 : Math.min(10_000, Math.max(0, divRound(d.earned * 10_000, d.max, profile.rounding)));
      return { domain, earned: d.earned, max: d.max, bp, met: profile.domainMinBp === undefined ? null : d.max === 0 || bp >= profile.domainMinBp };
    });

  let pass = max > 0 && (profile.pass.kind === "percent" ? rawBp >= profile.pass.minBp : (scaled ?? -Infinity) >= profile.pass.min);
  if (pass && domains.some((d) => d.met === false)) pass = false;
  return { earned, max, rawBp, scaled, pass, domains, items, counts };
}
