export type QType = "mcq" | "multi" | "fib" | "dnd" | "pbq";
export type Mode = "practice" | "timed" | "exam_sim";
export type Outcome = "correct" | "partial" | "incorrect" | "unanswered" | "excluded";

export interface Opt {
  id: string;
  text: string;
}
export interface PbqField {
  path: string;
  label: string;
  kind: "text" | "number" | "select" | "checkbox";
  options?: string[];
}
/** A question as the editor sees it (answer key included). */
export interface EditorQuestion {
  id: string;
  type: QType;
  stem: string;
  payload: any;
  key: any;
  explanation: string;
  difficulty: number | null;
  domain: string | null;
  objectiveId?: string | null;
  weight: number;
  isPretest: boolean;
  status: "draft" | "published";
  source: string;
  version: number;
}
/** A question as an attempt presents it (no key). */
export interface PlayQuestion {
  id: string;
  order: number;
  type: QType;
  stem: string;
  weight: number;
  domain?: string | null;
  /** Why a weak-area drill picked this question. */
  drillReason?: string | null;
  payload: any;
  response: any;
  flagged: boolean;
  timeMs: number;
  feedback?: { outcome: Outcome; earned: number; max: number; detail: any; explanation: string; key: any };
}
export interface DomainResult {
  domain: string;
  earned: number;
  max: number;
  bp: number;
  met: boolean | null;
}
export interface AttemptResult {
  earned: number;
  max: number;
  rawBp: number;
  scaled: number | null;
  pass: boolean;
  domains: DomainResult[];
  counts: Record<Outcome, number>;
}
export interface Attempt {
  id: string;
  /** For a weak-area drill this is the archive id. */
  itemId: string;
  archiveId: string;
  kind?: "quiz" | "drill";
  mode: Mode;
  status: "in_progress" | "submitted" | "expired";
  startedAt: string;
  deadlineAt: string | null;
  extraTimePct?: number;
  submittedAt: string | null;
  serverTime?: string;
  profile: { id: string; name: string; fidelity: "published_formula" | "community_estimate" | "custom" };
  result?: AttemptResult;
  questions?: PlayQuestion[];
  resumed?: boolean;
}
export interface QuizConfig {
  itemId: string;
  mode: Mode;
  timeLimitSeconds: number | null;
  questionCount: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  scoringProfileId: string | null;
  graceSeconds: number;
  publishedQuestions: number;
  canEdit: boolean;
}
export interface Profile {
  id: string;
  name: string;
  version: number;
  official: boolean;
  fidelity: "published_formula" | "community_estimate" | "custom";
  source: string | null;
  verifiedOn: string | null;
  definition: Record<string, unknown>;
}

export const FIDELITY_LABEL: Record<Profile["fidelity"], string> = {
  published_formula: "Published formula",
  community_estimate: "Community estimate",
  custom: "Custom",
};
export const MODE_LABEL: Record<Mode, string> = { practice: "Practice", timed: "Timed", exam_sim: "Exam simulation" };
export const TYPE_LABEL: Record<QType, string> = { mcq: "Multiple choice", multi: "Select all that apply", fib: "Fill in the blank", dnd: "Match items", pbq: "Scenario (lab)" };

/** Basis points as a percentage string: 6667 -> "66.7%". */
export const pct = (bp: number) => `${(bp / 100).toFixed(1).replace(/\.0$/, "")}%`;
export const points = (milli: number) => (milli / 1000).toFixed(milli % 1000 ? 2 : 0).replace(/(\.\d)0$/, "$1");

export function pathSet(root: Record<string, any>, path: string, value: unknown): Record<string, any> {
  const next = structuredClone(root ?? {});
  const parts = path.split(".");
  let cur: any = next;
  parts.forEach((p, i) => {
    if (p === "__proto__" || p === "constructor" || p === "prototype") return;
    if (i === parts.length - 1) cur[p] = value;
    else {
      if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = /^\d+$/.test(parts[i + 1]!) ? [] : {};
      cur = cur[p];
    }
  });
  return next;
}
export function pathGet(root: any, path: string): any {
  return path.split(".").reduce((c, p) => (c == null ? undefined : c[p]), root);
}

/** Minutes left at which a screen reader is told how much time remains. */
export const TIME_NOTICES = [30, 15, 10, 5, 1];

/** The sentence to announce when the whole minutes left go from `prev` to `mins`, or null. `prev` null is the first look at the clock. */
export function timeNotice(prev: number | null, mins: number): string | null {
  if (mins <= 0 || mins === prev) return null;
  if (prev === null) return `${mins} ${mins === 1 ? "minute" : "minutes"} remaining.`;
  const crossed = TIME_NOTICES.some((m) => m < prev && m >= mins);
  return crossed ? `${mins} ${mins === 1 ? "minute" : "minutes"} remaining.` : null;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
}
