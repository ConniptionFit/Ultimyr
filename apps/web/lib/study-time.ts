export interface TimeEntry {
  id: string;
  archiveId: string;
  day: string;
  minutes: number;
  note: string;
  source: "timer" | "manual";
}
export interface TimeLog {
  days: number;
  totalMinutes: number;
  byDay: { date: string; minutes: number }[];
  byCourse: { archiveId: string; title: string; minutes: number }[];
  entries: TimeEntry[];
}

/** "1 h 05 min", "45 min", "0 min". */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Elapsed timer time as whole minutes to log: 30 seconds or more rounds up to at least one minute; shorter is not worth logging. */
export function minutesToLog(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 0;
  return Math.min(1440, Math.max(1, Math.round(elapsedMs / 60_000)));
}

/** "12:05" or "1:02:09" for a running timer. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
