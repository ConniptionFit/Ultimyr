export interface Analytics {
  range: { days: number };
  summary: { attempts: number; accuracyBp: number; minutes: number; streakDays: number };
  daily: { date: string; attempts: number; accuracyBp: number; minutes: number }[];
  domains: { domain: string; accuracyBp: number; questions: number; correct: number }[];
  weak: { domain: string; accuracyBp: number; questions: number }[];
  readiness: { bp: number | null; basedOn: number; note: string } | null;
  goal: { archiveId: string; targetBp: number; targetDate: string | null; daysLeft: number | null; gapBp: number | null; onTrack: boolean | null } | null;
}
export interface StudyStats {
  learning: number;
  review: number;
  dueNow: number;
  reviewedToday: number;
  retentionBp: number | null;
  recalls30d: number;
  forecast: number[];
}
export interface StudyCard {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  deckTitle: string;
  state: number;
  /** Times the card was forgotten after being learned. Absent on the first card of an older server. */
  lapses?: number;
  next: Record<"1" | "2" | "3" | "4", { due: string; days: number }>;
}
export interface StudyQueue {
  settings: { desiredRetention: number; newPerDay: number };
  counts: { due: number; new: number; newAllowanceLeft: number };
  cards: StudyCard[];
}

/** "1 min", "10 min", "3 days" for the rating buttons. */
export function formatNext(n: { due: string; days: number }, now = Date.now()): string {
  if (n.days >= 1) return n.days === 1 ? "1 day" : n.days < 60 ? `${n.days} days` : `${Math.round(n.days / 30)} months`;
  const mins = Math.max(1, Math.round((new Date(n.due).getTime() - now) / 60_000));
  return `${mins} min`;
}

/** A card forgotten this many times is a "leech": the way it is written is probably the problem, not your memory. */
export const LEECH_LAPSES = 6;
export const isLeech = (card: { lapses?: number }) => (card.lapses ?? 0) >= LEECH_LAPSES;
