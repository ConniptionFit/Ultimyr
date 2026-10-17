"use client";

import { Play, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { downloadApi } from "@/lib/download";
import { useNaming } from "@/lib/naming";
import { formatElapsed, formatMinutes, minutesToLog, type TimeLog } from "@/lib/study-time";
import type { Archive } from "@/lib/types";

const KEY = "ultimyr_study_timer";
const input = "rounded-md border border-line bg-surface px-3 py-2 text-ink";

interface Running {
  archive: string;
  startedAt: number;
}
const readTimer = (): Running | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Running | null;
    return v && typeof v.archive === "string" && typeof v.startedAt === "number" ? v : null;
  } catch {
    return null;
  }
};
const writeTimer = (v: Running | null) => {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the timer still runs on this page */
  }
};

/** A timer and a log of your own study time, per course. The timer survives a page reload (kept in this browser). */
export function StudyTimePanel({ archives, archive: selected }: { archives: Archive[]; archive: string }) {
  const { api, state } = useAuth();
  const { t } = useNaming();
  const [log, setLog] = useState<TimeLog | null>(null);
  const [course, setCourse] = useState(selected || archives[0]?.id || "");
  const [running, setRunning] = useState<Running | null>(null);
  const [now, setNow] = useState(Date.now());
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => setCourse(selected || archives[0]?.id || ""), [selected, archives]);
  useEffect(() => setRunning(readTimer()), []);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const load = useCallback(async () => {
    try {
      setLog(await api<TimeLog>("GET", `study/time?days=30&tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}${selected ? `&archive=${selected}` : ""}`));
    } catch {
      setLog(null);
    }
  }, [api, selected]);
  useEffect(() => void load(), [load]);

  const title = (id: string) => archives.find((a) => a.id === id)?.title ?? "A course";

  async function add(mins: number, source: "timer" | "manual", archiveId: string, why = "") {
    try {
      await api("POST", "study/time", { archiveId, minutes: mins, source, note: why, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setMsg(`Logged ${formatMinutes(mins)} on ${title(archiveId)}.`);
      await load();
      return true;
    } catch {
      setMsg("Could not save that. Try again.");
      return false;
    }
  }

  function start() {
    const r = { archive: course, startedAt: Date.now() };
    writeTimer(r);
    setRunning(r);
    setNow(Date.now());
    setMsg("");
  }
  async function stop() {
    if (!running) return;
    const mins = minutesToLog(Date.now() - running.startedAt);
    writeTimer(null);
    setRunning(null);
    if (!mins) return setMsg("That was under half a minute, so nothing was logged.");
    await add(mins, "timer", running.archive);
  }
  async function manual(e: FormEvent) {
    e.preventDefault();
    const n = Math.round(Number(minutes));
    if (!(n >= 1 && n <= 1440)) return setMsg("Enter minutes from 1 to 1,440.");
    if (await add(n, "manual", course, note)) {
      setMinutes("");
      setNote("");
    }
  }
  async function remove(id: string) {
    try {
      await api("DELETE", `study/time/${id}`);
      await load();
    } catch {
      setMsg("Could not delete that entry.");
    }
  }

  if (archives.length === 0) return null;
  return (
    <section aria-labelledby="time-h" className="space-y-3 rounded-md border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="time-h" className="text-xl">
          {t("studyTime")}
        </h2>
        {log && <p className="text-sm text-muted">{formatMinutes(log.totalMinutes)} in the last 30 days</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="time-course">
          Course
        </label>
        <select id="time-course" value={running ? running.archive : course} disabled={!!running} onChange={(e) => setCourse(e.target.value)} className={`${input} min-w-0 max-w-full`}>
          {archives.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        {running ? (
          <button onClick={stop} className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-accent-ink">
            <Square size={14} aria-hidden /> Stop and log <span className="font-mono" role="timer" aria-live="off">{formatElapsed(now - running.startedAt)}</span>
          </button>
        ) : (
          <button onClick={start} className="flex items-center gap-2 rounded-md border border-line px-4 py-2 hover:bg-surface">
            <Play size={14} aria-hidden /> Start timer
          </button>
        )}
      </div>
      <form onSubmit={manual} className="flex flex-wrap items-end gap-2">
        <label className="text-sm text-muted">
          Or add minutes
          <input type="number" min={1} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`mt-1 block w-28 ${input}`} />
        </label>
        <label className="min-w-0 flex-1 text-sm text-muted">
          Note (optional)
          <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={`mt-1 block w-full ${input}`} placeholder="Lab: subnetting" />
        </label>
        <button type="submit" className="rounded-md border border-line px-4 py-2 hover:bg-surface">
          Add
        </button>
      </form>
      {msg && (
        <p role="status" className="text-sm text-muted">
          {msg}
        </p>
      )}
      {log && log.byCourse.length > 0 && (
        <ul className="space-y-1 text-sm">
          {log.byCourse.map((c) => (
            <li key={c.archiveId} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{c.title}</span>
              <span className="shrink-0 text-muted">{formatMinutes(c.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
      {log && log.entries.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Recent entries</summary>
          <ul className="mt-2 divide-y divide-line">
            {log.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 truncate">
                  {e.day} · {formatMinutes(e.minutes)} · {title(e.archiveId)}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
                <button onClick={() => remove(e.id)} aria-label="Delete entry" className="shrink-0 text-muted hover:text-danger">
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={async () => state.status === "authenticated" && ((await downloadApi(state.accessToken, "study/time/export", "ultimyr-study-time.csv")) || setMsg("Could not download your log."))}
            className="mt-2 text-accent underline"
          >
            Download as CSV
          </button>
        </details>
      )}
    </section>
  );
}
