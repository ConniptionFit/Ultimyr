"use client";

import { Flame, Search, Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { useDisplay } from "@/lib/display";
import { searchNotes, type NoteText } from "@/lib/note-search";
import { pct } from "@/lib/quiz";
import type { Analytics } from "@/lib/progress";
import { planSession, type SessionPlan } from "@/lib/session";
import type { RoadmapStep } from "@/lib/types";

const KEY = "ultimyr_session_minutes";
export const SESSION_CHOICES = [0, 20, 45, 90] as const;

/** Today's session length, kept in this browser. 0 means no plan. */
export function useSessionPlan(leaves: RoadmapStep[]): { minutes: number; setMinutes: (m: number) => void; plan: SessionPlan | null } {
  const [minutes, setMinutesState] = useState(0);
  useEffect(() => {
    try {
      const m = Number(localStorage.getItem(KEY));
      if ((SESSION_CHOICES as readonly number[]).includes(m)) setMinutesState(m);
    } catch {}
  }, []);
  const setMinutes = (m: number) => {
    setMinutesState(m);
    try {
      localStorage.setItem(KEY, String(m));
    } catch {}
  };
  const plan = useMemo(() => (minutes ? planSession(leaves, minutes) : null), [leaves, minutes]);
  return { minutes, setMinutes, plan };
}

export function SessionBar({ minutes, setMinutes, plan }: { minutes: number; setMinutes: (m: number) => void; plan: SessionPlan | null }) {
  const { t, copy } = useNaming();
  return (
    <div className="space-y-2 rounded-md border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${t("session")} length`}>
        <span className="text-muted">{t("session")}:</span>
        {SESSION_CHOICES.map((m) => (
          <button key={m} type="button" aria-pressed={minutes === m} onClick={() => setMinutes(m)} className={`rounded-md border px-2 py-1 ${minutes === m ? "border-accent text-ink" : "border-line text-muted hover:text-ink"}`}>
            {m === 0 ? "Off" : `${m} min`}
          </button>
        ))}
      </div>
      {plan && plan.ids.length > 0 && (
        <p className="text-muted">
          {plan.ids.length} {plan.ids.length === 1 ? "step" : "steps"}, about {plan.minutes} min, marked <span className="rounded-full border border-accent px-2 text-xs text-ink">{copy("todayBadge")}</span> below.
        </p>
      )}
      {plan && plan.ids.length === 0 && <p className="text-accent">Nothing left to plan. The required steps are done.</p>}
    </div>
  );
}

/** Streak, readiness and the weakest area for this archive, from your quiz results. Quiet: one line, hidden by Calm mode for the streak. */
export function PathStats({ archiveId }: { archiveId: string }) {
  const { api } = useAuth();
  const { display } = useDisplay();
  const { mode, t } = useNaming();
  const [a, setA] = useState<Analytics | null>(null);
  useEffect(() => {
    let live = true;
    api<Analytics>("GET", `analytics?archive=${archiveId}&days=30`)
      .then((r) => live && setA(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, archiveId]);
  if (!a) return null;
  const bp = a.readiness?.bp ?? null;
  const weak = a.weak[0];
  const streak = a.summary.streakDays;
  if (bp === null && !weak && !(streak > 0 && !display.calm)) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
      {mode === "themed" && <span className="font-medium text-ink">{t("stats")}</span>}
      {streak > 0 && !display.calm && (
        <span className="inline-flex items-center gap-1">
          <Flame size={14} aria-hidden /> {streak} {streak === 1 ? "day" : "days"} of practice in a row
        </span>
      )}
      {bp !== null && (
        <span className="inline-flex items-center gap-1" title={a.readiness?.note}>
          <Target size={14} aria-hidden /> Readiness about {pct(bp)}
          {a.goal?.targetBp ? ` of ${pct(a.goal.targetBp)} goal` : ""}
        </span>
      )}
      {weak && (
        <span>
          Weakest: {weak.domain} ({pct(weak.accuracyBp)}){" "}
          <Link href={`/drills?archive=${archiveId}`} className="text-accent underline">
            Drill it
          </Link>
        </span>
      )}
    </p>
  );
}

/** Search your own notes for this path. Loads them once, when you first type. */
export function NoteFinder({ archiveId, titleOf }: { archiveId: string; titleOf: (stepId: string) => string | null }) {
  const { api } = useAuth();
  const { t } = useNaming();
  const [q, setQ] = useState("");
  const [notes, setNotes] = useState<NoteText[] | null>(null);
  useEffect(() => {
    if (!q.trim() || notes) return;
    api<{ notes: NoteText[] }>("GET", `notes/archives/${archiveId}/text`)
      .then((r) => setNotes(r.notes))
      .catch(() => setNotes([]));
  }, [q, notes, api, archiveId]);
  const hits = notes ? searchNotes(notes, q) : [];
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm">
        <Search size={14} className="text-muted" aria-hidden />
        <span className="sr-only">{t("noteSearch")} your notes</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${t("noteSearch")} your notes`} className="w-full bg-transparent text-ink outline-none" />
      </label>
      {q.trim() && notes && (
        <ul className="divide-y divide-line rounded-md border border-line text-sm" aria-live="polite">
          {hits.length === 0 && <li className="p-3 text-muted">No notes match.</li>}
          {hits.map((h) => (
            <li key={h.stepId}>
              <a href={`#step-${h.stepId}`} className="block p-3 hover:bg-surface">
                <span className="block">{titleOf(h.stepId) ?? "A step"}</span>
                <span className="block text-muted">{h.snippet}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** All of your notes for one stage, in order, to read in one go. */
export function StageDigest({ archiveId, steps, titleOf }: { archiveId: string; steps: string[]; titleOf: (stepId: string) => string | null }) {
  const { api } = useAuth();
  const [notes, setNotes] = useState<NoteText[] | null>(null);
  useEffect(() => {
    api<{ notes: NoteText[] }>("GET", `notes/archives/${archiveId}/text`)
      .then((r) => setNotes(r.notes))
      .catch(() => setNotes([]));
  }, [api, archiveId]);
  if (!notes) return <p className="text-sm text-muted">Loading…</p>;
  const mine = steps.map((id) => notes.find((n) => n.stepId === id)).filter((n): n is NoteText => !!n);
  if (!mine.length) return <p className="rounded-md border border-line p-3 text-sm text-muted">No notes in this stage yet.</p>;
  return (
    <div className="space-y-4 rounded-md border border-line p-3 text-sm">
      {mine.map((n) => (
        <section key={n.stepId}>
          <h4 className="font-serif text-base">{titleOf(n.stepId)}</h4>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-ink/90">{n.content}</pre>
        </section>
      ))}
    </div>
  );
}
