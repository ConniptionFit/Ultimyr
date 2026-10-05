"use client";

import { streakText } from "@ultimyr/lore";
import { Printer } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { BarChart, Meter } from "@/components/charts";
import { Loading } from "@/components/loading";
import { Header } from "@/components/header";
import { Button, Field, Shell } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import type { Analytics, StudyStats } from "@/lib/progress";
import { pct } from "@/lib/quiz";
import type { Archive } from "@/lib/types";

function Progress() {
  const { state, api } = useAuth();
  const { t, mode } = useNaming();
  const router = useRouter();
  const params = useSearchParams();
  const [archives, setArchives] = useState<Archive[] | null>(null);
  const [archive, setArchive] = useState<string>(params.get("archive") ?? "");
  const [days, setDays] = useState(30);
  const [an, setAn] = useState<Analytics | null>(null);
  const [study, setStudy] = useState<StudyStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status === "authenticated") api<{ archives: Archive[] }>("GET", "archives").then((r) => setArchives(r.archives)).catch(() => setArchives([]));
  }, [state.status, router, api]);

  const load = useCallback(async () => {
    if (state.status !== "authenticated") return;
    const qs = `${archive ? `archive=${archive}&` : ""}`;
    try {
      const [a, s] = await Promise.all([api<Analytics>("GET", `analytics?${qs}days=${days}`), api<StudyStats>("GET", `study/stats?${qs}`.replace(/[?&]$/, ""))]);
      setAn(a);
      setStudy(s);
    } catch {
      setError("Could not load your progress.");
    }
  }, [api, archive, days, state.status]);
  useEffect(() => void load(), [load]);

  async function saveGoal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("PUT", `goals/${archive}`, { targetBp: Math.round(Number(f.get("target")) * 100), targetDate: String(f.get("date")) || null });
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0] ?? err.code.replaceAll("_", " ")) : "Could not save the goal.");
    }
  }

  if (!an || !archives) {
    return (
      <>
        <Header />
        <Shell>
          <Loading />
        </Shell>
      </>
    );
  }
  const sel = "rounded-md border border-line bg-surface px-3 py-2 text-ink";
  return (
    <>
      <Header />
      <Shell>
        <div className="ulti-fade space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl">Progress</h1>
              <p className="hidden text-sm text-muted print:block">
                {state.status === "authenticated" ? state.user.displayName : ""} · {archive ? archives.find((a) => a.id === archive)?.title : "All courses"} · last {days} days · {new Date().toLocaleDateString()}
              </p>
            </div>
            <div className="no-print flex gap-2">
              <label className="sr-only" htmlFor="pg-archive">
                {t("archive")}
              </label>
              <select id="pg-archive" value={archive} onChange={(e) => setArchive(e.target.value)} className={sel}>
                <option value="">All {t("archives").toLowerCase()}</option>
                {archives.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor="pg-days">
                Time range
              </label>
              <select id="pg-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className={sel}>
                {[7, 30, 90, 365].map((d) => (
                  <option key={d} value={d}>
                    Last {d} days
                  </option>
                ))}
              </select>
              <Button variant="quiet" onClick={() => window.print()} title="Print or save as PDF, a transcript of this view">
                <Printer size={16} aria-hidden /> Print
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Attempts", String(an.summary.attempts)],
              ["Accuracy", an.summary.attempts ? pct(an.summary.accuracyBp) : "—"],
              ["Minutes studied", String(an.summary.minutes)],
              [t("streak"), `${an.summary.streakDays} ${an.summary.streakDays === 1 ? "day" : "days"}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-line p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-2xl">{v}</dd>
              </div>
            ))}
          </dl>

          {an.summary.streakDays > 0 && <p className="text-sm text-muted">{streakText(an.summary.streakDays, mode)}</p>}

          {archive && an.readiness && (
            <section aria-labelledby="ready-h" className="space-y-3 rounded-md border border-line p-4">
              <h2 id="ready-h" className="text-xl">
                Readiness
              </h2>
              {an.readiness.bp === null ? (
                <p className="text-muted">{an.readiness.note}</p>
              ) : (
                <>
                  <p className="text-3xl">{pct(an.readiness.bp)}</p>
                  <Meter value={an.readiness.bp} label="Readiness" />
                  <p className="text-sm text-muted">{an.readiness.note}</p>
                </>
              )}
              <form onSubmit={saveGoal} className="no-print grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field id="goal-target" name="target" label="Target score (%)" type="number" min={1} max={100} defaultValue={an.goal ? an.goal.targetBp / 100 : 80} required />
                <Field id="goal-date" name="date" label="Exam date (optional)" type="date" defaultValue={an.goal?.targetDate ?? ""} />
                <Button type="submit">{an.goal ? "Update goal" : "Set goal"}</Button>
              </form>
              <p className="no-print flex flex-wrap gap-4 text-sm">
                <Link href={`/drills?archive=${archive}`} className="text-accent underline">
                  Drill your weak areas
                </Link>
                <Link href={`/exam-day?archive=${archive}${an.goal?.targetDate ? `&date=${an.goal.targetDate}` : ""}`} className="text-accent underline">
                  Exam countdown plan
                </Link>
              </p>
              {an.goal && (
                <p className="text-sm" role="status">
                  {an.goal.onTrack === null
                    ? "Goal saved. Take a few attempts to see how you are tracking."
                    : an.goal.onTrack
                      ? `You are at your ${pct(an.goal.targetBp)} target.`
                      : `${pct(an.goal.gapBp ?? 0)} to go to reach ${pct(an.goal.targetBp)}.`}
                  {an.goal.daysLeft !== null && ` ${an.goal.daysLeft >= 0 ? `${an.goal.daysLeft} days until your exam.` : "Your exam date has passed."}`}
                </p>
              )}
            </section>
          )}

          <section aria-labelledby="daily-h" className="space-y-2">
            <h2 id="daily-h" className="text-xl">
              Accuracy by day
            </h2>
            {an.daily.length === 0 ? <p className="text-muted">No attempts in this range yet.</p> : <BarChart label="Accuracy for each day you took an attempt" max={10_000} data={an.daily.map((d) => ({ label: d.date, value: d.accuracyBp }))} />}
          </section>

          <section aria-labelledby="dom-h" className="space-y-3">
            <h2 id="dom-h" className="text-xl">
              By domain
            </h2>
            {an.domains.length === 0 && <p className="text-muted">Domains appear once you answer questions that have one.</p>}
            <ul className="space-y-3">
              {an.domains.map((d) => (
                <li key={d.domain} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{d.domain}</span>
                    <span className="text-muted">
                      {pct(d.accuracyBp)} · {d.correct} of {d.questions} right
                    </span>
                  </div>
                  <Meter value={d.accuracyBp} label={`${d.domain} accuracy`} tone={an.weak.some((w) => w.domain === d.domain) ? "danger" : "accent"} />
                </li>
              ))}
            </ul>
            {an.weak.length > 0 && <p className="text-sm text-muted">Start with {an.weak.map((w) => w.domain).join(", ")}.</p>}
          </section>

          {study && (
            <section aria-labelledby="srs-h" className="space-y-3 rounded-md border border-line p-4">
              <div className="flex items-center justify-between">
                <h2 id="srs-h" className="text-xl">
                  {t("queue")}
                </h2>
                <Link href={`/study${archive ? `?archive=${archive}` : ""}`} className="text-sm text-accent underline">
                  {study.dueNow ? `Study ${study.dueNow} due` : "Open"}
                </Link>
              </div>
              <p className="text-sm text-muted">
                {study.reviewedToday} reviewed today · {study.learning} learning · {study.review} in review
                {study.retentionBp !== null ? ` · ${pct(study.retentionBp)} recalled over the last 30 days (${study.recalls30d} reviews)` : ""}
              </p>
              <BarChart label="Cards due each day for the next week" data={study.forecast.map((n, i) => ({ label: i === 0 ? "today" : `in ${i} days`, value: n }))} />
            </section>
          )}
        </div>
      </Shell>
    </>
  );
}

export default function ProgressPage() {
  return (
    <Suspense>
      <Progress />
    </Suspense>
  );
}
