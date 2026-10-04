/**
 * The exam objective coverage map: for every objective, what study material and practice questions support it, and what
 * is missing. Pure. The content service supplies the objective tree with material counts, the quiz service supplies
 * question counts and the person's own results, and this joins them. Web and MCP share it so they always agree.
 */
export interface MaterialCounts {
  guides: number;
  decks: number;
  cards: number;
  resources: number;
}
export interface ObjectiveNode {
  id: string;
  code: string;
  title: string;
  summary?: string;
  weightBp: number | null;
  counts: MaterialCounts;
  children?: ObjectiveNode[];
}
export interface QuizStat {
  objectiveId: string;
  questions: number;
  drafts: number;
  answered: number;
  correct: number;
  accuracyBp: number | null;
}
export interface QuizStats {
  objectives: QuizStat[];
  unmapped: { questions: number; drafts: number; answered: number; correct: number; accuracyBp: number | null };
}

export type CoverageStatus = "gap" | "thin" | "covered";
export type Mastery = "unknown" | "weak" | "ok";

export interface Thresholds {
  /** Flashcards an objective needs to count as covered. */
  minCards: number;
  /** Practice questions an objective needs to count as covered. */
  minQuestions: number;
  /** Below this accuracy, with enough answers behind it, an objective is weak. */
  weakBelowBp: number;
  /** Answers needed before accuracy means anything. */
  minAnswered: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = { minCards: 5, minQuestions: 3, weakBelowBp: 7000, minAnswered: 3 };

export interface CoverageRow {
  id: string;
  code: string;
  title: string;
  weightBp: number | null;
  level: 0 | 1;
  counts: MaterialCounts;
  questions: number;
  drafts: number;
  answered: number;
  accuracyBp: number | null;
  status: CoverageStatus;
  mastery: Mastery;
  /** Plain words for what is missing, empty when covered. */
  missing: string[];
  children?: CoverageRow[];
}
export interface CoverageSummary {
  objectives: number;
  covered: number;
  thin: number;
  gap: number;
  weak: number;
  /** Weighted share of the exam with enough material and practice behind it, 0 to 10000. Null when there are no objectives. */
  coverageBp: number | null;
  unmappedQuestions: number;
}
export interface Coverage {
  rows: CoverageRow[];
  summary: CoverageSummary;
}

const NONE: QuizStat = { objectiveId: "", questions: 0, drafts: 0, answered: 0, correct: 0, accuracyBp: null };
const hasStudyMaterial = (c: MaterialCounts) => c.guides + c.decks + c.resources > 0;

function evaluate(counts: MaterialCounts, questions: number, t: Thresholds): { status: CoverageStatus; missing: string[] } {
  if (!hasStudyMaterial(counts) && counts.cards === 0 && questions === 0) return { status: "gap", missing: ["study material", "flashcards", "practice questions"] };
  const missing: string[] = [];
  if (!hasStudyMaterial(counts)) missing.push("a study guide, deck or resource");
  if (counts.cards < t.minCards) missing.push(`flashcards (${counts.cards} of ${t.minCards})`);
  if (questions < t.minQuestions) missing.push(`practice questions (${questions} of ${t.minQuestions})`);
  return { status: missing.length ? "thin" : "covered", missing };
}

function masteryOf(answered: number, accuracyBp: number | null, t: Thresholds): Mastery {
  if (accuracyBp === null || answered < t.minAnswered) return "unknown";
  return accuracyBp < t.weakBelowBp ? "weak" : "ok";
}

/** Combine children's stats into one for their domain. */
function sum(stats: QuizStat[]): QuizStat {
  const answered = stats.reduce((s, x) => s + x.answered, 0);
  const correct = stats.reduce((s, x) => s + x.correct, 0);
  return {
    objectiveId: "",
    questions: stats.reduce((s, x) => s + x.questions, 0),
    drafts: stats.reduce((s, x) => s + x.drafts, 0),
    answered,
    correct,
    accuracyBp: answered > 0 ? Math.min(10_000, Math.round((correct * 10_000) / answered)) : null,
  };
}

export function buildCoverage(tree: ObjectiveNode[], stats: QuizStats | null, thresholds: Partial<Thresholds> = {}): Coverage {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const byId = new Map((stats?.objectives ?? []).map((s) => [s.objectiveId, s]));
  const stat = (id: string) => byId.get(id) ?? NONE;

  const leafRow = (n: ObjectiveNode, level: 0 | 1): CoverageRow => {
    const s = stat(n.id);
    const e = evaluate(n.counts, s.questions, t);
    return { id: n.id, code: n.code, title: n.title, weightBp: n.weightBp, level, counts: n.counts, questions: s.questions, drafts: s.drafts, answered: s.answered, accuracyBp: s.accuracyBp, mastery: masteryOf(s.answered, s.accuracyBp, t), ...e };
  };

  const rows: CoverageRow[] = tree.map((d) => {
    const kids = (d.children ?? []).map((k) => leafRow(k, 1));
    if (!kids.length) return leafRow(d, 0);
    // A domain's own links count toward the domain only; its status comes from the objectives inside it.
    const own = stat(d.id);
    const total = sum([own, ...kids.map((k) => ({ ...NONE, questions: k.questions, drafts: k.drafts, answered: k.answered, correct: stat(k.id).correct }))]);
    const covered = kids.filter((k) => k.status === "covered").length;
    const gaps = kids.filter((k) => k.status === "gap").length;
    const status: CoverageStatus = covered === kids.length ? "covered" : gaps === kids.length && !hasStudyMaterial(d.counts) && d.counts.cards === 0 && total.questions === 0 ? "gap" : "thin";
    const missing = status === "covered" ? [] : [`${kids.length - covered} of ${kids.length} objectives need more`];
    return {
      id: d.id,
      code: d.code,
      title: d.title,
      weightBp: d.weightBp,
      level: 0 as const,
      counts: d.counts,
      questions: total.questions,
      drafts: total.drafts,
      answered: total.answered,
      accuracyBp: total.accuracyBp,
      mastery: masteryOf(total.answered, total.accuracyBp, t),
      status,
      missing,
      children: kids,
    };
  });

  // Coverage share: each domain contributes covered=1, thin=0.5, gap=0 across its objectives, weighted by the domain's exam weight
  // (domains with no weight share what is left equally).
  const leaves = (r: CoverageRow) => (r.children?.length ? r.children : [r]);
  const score = (r: CoverageRow) => {
    const l = leaves(r);
    return l.reduce((s, x) => s + (x.status === "covered" ? 1 : x.status === "thin" ? 0.5 : 0), 0) / l.length;
  };
  const weighted = rows.filter((r) => r.weightBp !== null);
  const set = weighted.reduce((s, r) => s + (r.weightBp ?? 0), 0);
  const unweighted = rows.filter((r) => r.weightBp === null);
  const share = unweighted.length ? Math.max(0, 10_000 - set) / unweighted.length : 0;
  const w = (r: CoverageRow) => r.weightBp ?? share;
  const totalW = rows.reduce((s, r) => s + w(r), 0);
  const coverageBp = !rows.length ? null : totalW > 0 ? Math.round((rows.reduce((s, r) => s + score(r) * w(r), 0) * 10_000) / totalW) : Math.round((rows.reduce((s, r) => s + score(r), 0) * 10_000) / rows.length);

  const all = rows.flatMap(leaves);
  return {
    rows,
    summary: {
      objectives: all.length,
      covered: all.filter((r) => r.status === "covered").length,
      thin: all.filter((r) => r.status === "thin").length,
      gap: all.filter((r) => r.status === "gap").length,
      weak: all.filter((r) => r.mastery === "weak").length,
      coverageBp,
      unmappedQuestions: stats?.unmapped.questions ?? 0,
    },
  };
}

/** The gaps worth fixing first: the heaviest, emptiest objectives. For a to-do list or an AI helper's plan. */
export function topGaps(c: Coverage, limit = 5): CoverageRow[] {
  const domainWeight = new Map<string, number>();
  for (const d of c.rows) for (const k of d.children ?? []) domainWeight.set(k.id, d.weightBp ?? 0);
  const leaves = c.rows.flatMap((r) => (r.children?.length ? r.children : [r]));
  const rank = { gap: 0, thin: 1, covered: 2 } as const;
  return leaves
    .filter((r) => r.status !== "covered")
    .sort((a, b) => rank[a.status] - rank[b.status] || (domainWeight.get(b.id) ?? b.weightBp ?? 0) - (domainWeight.get(a.id) ?? a.weightBp ?? 0) || a.code.localeCompare(b.code, undefined, { numeric: true }) || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** How much to build per objective. */
export type Depth = "quick" | "standard" | "deep";
export const DEPTH: Record<Depth, { cards: number; questions: number }> = {
  quick: { cards: 5, questions: 3 },
  standard: { cards: 10, questions: 6 },
  deep: { cards: 20, questions: 12 },
};

export interface BuildTask {
  type: "guide" | "cards" | "questions";
  /** The exam domain the task belongs to. */
  domain: { id: string; code: string; title: string; weightBp: number | null };
  /** The objectives the new material must be linked to. */
  objectives: { id: string; code: string; title: string }[];
  /** For cards and questions: how many more to add. */
  need?: number;
}
export interface BuildQueue {
  done: boolean;
  /** Share of the wanted material that exists, 0 to 10000. */
  progressBp: number;
  remaining: { guides: number; cards: number; questions: number; tasks: number };
  tasks: BuildTask[];
}

/**
 * The to-do list for building an archive out: a guide for each domain (linked to the objectives it covers), then
 * flashcards and practice questions up to the chosen depth for each objective. Heaviest domains first. Pure, so a new
 * chat can pick up exactly where an old one stopped. Draft questions count, so work in flight is not repeated.
 */
export function buildQueue(c: Coverage, depth: Depth = "standard", batch = 4): BuildQueue {
  const want = DEPTH[depth];
  const domains = [...c.rows].sort((a, b) => (b.weightBp ?? -1) - (a.weightBp ?? -1) || a.code.localeCompare(b.code, undefined, { numeric: true }));
  const all: BuildTask[] = [];
  let have = 0;
  let need = 0;
  const rem = { guides: 0, cards: 0, questions: 0 };
  for (const d of domains) {
    const dom = { id: d.id, code: d.code, title: d.title, weightBp: d.weightBp };
    const leaves = d.children?.length ? d.children : [d];
    const noGuide = leaves.filter((l) => l.counts.guides === 0);
    need += leaves.length;
    have += leaves.length - noGuide.length;
    if (noGuide.length) {
      rem.guides += 1;
      all.push({ type: "guide", domain: dom, objectives: noGuide.map((l) => ({ id: l.id, code: l.code, title: l.title })) });
    }
    for (const l of leaves) {
      const o = [{ id: l.id, code: l.code, title: l.title }];
      const cards = Math.max(0, want.cards - l.counts.cards);
      const questions = Math.max(0, want.questions - l.questions - l.drafts);
      need += want.cards + want.questions;
      have += Math.min(l.counts.cards, want.cards) + Math.min(l.questions + l.drafts, want.questions);
      if (cards) {
        rem.cards += cards;
        all.push({ type: "cards", domain: dom, objectives: o, need: cards });
      }
      if (questions) {
        rem.questions += questions;
        all.push({ type: "questions", domain: dom, objectives: o, need: questions });
      }
    }
  }
  return {
    done: all.length === 0 && domains.length > 0,
    progressBp: need ? Math.round((have * 10_000) / need) : 0,
    remaining: { ...rem, tasks: all.length },
    tasks: all.slice(0, Math.max(1, batch)),
  };
}
