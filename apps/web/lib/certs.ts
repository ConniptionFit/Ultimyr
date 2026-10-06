import type { CoverageStatus, Mastery, MaterialCounts } from "@ultimyr/coverage";

export type CredentialStatus = "planned" | "scheduled" | "earned" | "retired";
export type ExamMode = "unknown" | "test_center" | "online";
export type Severity = "info" | "warn" | "urgent";

export interface Alert {
  credentialId: string;
  credentialName: string;
  kind: string;
  severity: Severity;
  date: string | null;
  daysLeft: number | null;
  message: string;
}
export interface Credential {
  id: string;
  name: string;
  issuer: string;
  archiveId: string | null;
  status: CredentialStatus;
  credentialNumber: string;
  examDate: string | null;
  examTime: string | null;
  examMode: ExamMode;
  examLocation: string;
  voucherCode: string;
  voucherExpires: string | null;
  earnedOn: string | null;
  expiresOn: string | null;
  renewalAlertDays: number;
  ceuRequired: number | null;
  ceuUnit: "CEU" | "PDU" | "CPE" | "hours";
  ceuLogged: number;
  notes: string;
  alerts: Alert[];
  entries?: CeuEntry[];
}
export interface CeuEntry {
  id: string;
  title: string;
  units: number;
  earnedOn: string;
  category: string;
  notes: string;
}

export const STATUS_LABEL: Record<CredentialStatus, string> = { planned: "Planned", scheduled: "Exam booked", earned: "Earned", retired: "Retired" };
export const MODE_LABEL: Record<ExamMode, string> = { unknown: "Not sure yet", test_center: "At a test centre", online: "Online, from home" };

/** A plain YYYY-MM-DD shown as a date, never shifted by the viewer's time zone. */
export function formatDay(day: string | null | undefined): string {
  if (!day) return "";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}
export function formatDayShort(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}
/** Today's date on the person's own calendar (not UTC), as YYYY-MM-DD. */
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function daysText(daysLeft: number | null): string {
  if (daysLeft === null) return "";
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft > 0) return `in ${daysLeft} days`;
  return daysLeft === -1 ? "yesterday" : `${-daysLeft} days ago`;
}

// ---- exam objectives and coverage ----
export interface ObjectiveTreeNode {
  id: string;
  code: string;
  title: string;
  summary: string;
  weightBp: number | null;
  order: number;
  counts: MaterialCounts;
  children?: ObjectiveTreeNode[];
}
export const STATUS_WORDS: Record<CoverageStatus, string> = { covered: "Covered", thin: "Thin", gap: "Gap" };
export const MASTERY_WORDS: Record<Mastery, string> = { unknown: "", weak: "Weak", ok: "Solid" };

// ---- weak-area drills ----
export type DrillFocus = "mixed" | "weak" | "missed";
export const FOCUS_LABEL: Record<DrillFocus, { name: string; hint: string }> = {
  mixed: { name: "Mixed", hint: "Weak spots plus questions you have not seen yet." },
  weak: { name: "Weakest topics", hint: "Only the topics where you score lowest." },
  missed: { name: "Redo misses", hint: "Only questions you got wrong last time." },
};
export const REASON_LABEL: Record<string, string> = { missed: "Missed last time", weak_area: "Weak topic", not_seen: "New to you", refresh: "Refresher" };

// ---- countdown plan ----
export interface PlanTask {
  kind: "review" | "drill" | "practice_exam" | "light_review" | "checklist" | "exam";
  title: string;
  detail: string;
  minutes: number | null;
  focus?: "weak" | "missed";
}
export interface PlanDay {
  date: string;
  daysLeft: number;
  phase: "build" | "consolidate" | "sharpen" | "taper" | "exam";
  tasks: PlanTask[];
}
export interface Plan {
  archiveId: string;
  usedGoalDate: boolean;
  examDate: string;
  daysLeft: number;
  status: "upcoming" | "today" | "past";
  phase: PlanDay["phase"] | null;
  phases: { id: PlanDay["phase"]; label: string; fromDaysLeft: number; toDaysLeft: number; summary: string }[];
  readiness: { bp: number | null; targetBp: number | null; gapBp: number | null };
  advice: string[];
  days: PlanDay[];
  truncated: boolean;
  checklist: string[];
}
