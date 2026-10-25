"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BarChart } from "@/components/charts";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useDisplay } from "@/lib/display";
import { useNaming } from "@/lib/naming";
import { FIDELITY_LABEL, MODE_LABEL, TYPE_LABEL, formatClock, pct, type Attempt, type EditorQuestion, type Mode, type Profile, type QuizConfig } from "@/lib/quiz";
import { QuestionEditor } from "./question-editor";

/** Everything a quiz item needs: start an attempt, see history, and (for editors) manage questions and settings. */
export function QuizPanel({ itemId, archiveId, editor, published, returnTo }: { itemId: string; archiveId: string; editor: boolean; published: boolean; returnTo?: string }) {
  const { api } = useAuth();
  const { t } = useNaming();
  const { display } = useDisplay();
  const router = useRouter();
  const [cfg, setCfg] = useState<QuizConfig | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [questions, setQuestions] = useState<EditorQuestion[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [mode, setMode] = useState<Mode>("practice");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [find, setFind] = useState("");
  const [analysis, setAnalysis] = useState<Record<string, { answers: number; people: number; correctBp: number; avgMs: number | null }>>({});
  const [openReports, setOpenReports] = useState<Record<string, number>>({});
  const [reports, setReports] = useState<{ id: string; questionId: string; stem: string; kind: string; message: string }[]>([]);
  const [area, setArea] = useState("");

  const drafts = questions.filter((q) => q.status === "draft");
  const areas = Array.from(new Set(questions.flatMap((q) => (q.domain ? [q.domain] : [])))).sort();
  const needle = find.trim().toLowerCase();
  const shownQuestions = questions.filter((q) => (!area || q.domain === area) && (!needle || q.stem.toLowerCase().includes(needle)));
  async function publishAllDrafts() {
    if (!confirm(`Publish ${drafts.length} draft questions? Learners will see them straight away.`)) return;
    try {
      for (const q of drafts) await api("PATCH", `questions/${q.id}`, { status: "published" });
    } catch (e) {
      fail(e);
    }
    await load();
  }
  const fail = (e: unknown) => setError(e instanceof ApiError ? (e.issues[0] ?? e.code.replaceAll("_", " ")) : "Something went wrong.");

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([api<QuizConfig>("GET", `quizzes/${itemId}/config`), api<{ attempts: Attempt[] }>("GET", `quizzes/${itemId}/attempts?limit=10`)]);
      setCfg(c);
      setMode(c.mode);
      setAttempts(a.attempts);
      if (c.canEdit) {
        const [q, p] = await Promise.all([api<{ questions: EditorQuestion[] }>("GET", `quizzes/${itemId}/questions`), api<{ profiles: Profile[] }>("GET", "scoring-profiles")]);
        setQuestions(q.questions);
        setProfiles(p.profiles);
        // Quality data is a bonus: the editor still works without it.
        api<{ questions: { questionId: string; answers: number; people: number; correctBp: number; avgMs: number | null }[]; openReports: Record<string, number> }>("GET", `quizzes/${itemId}/item-analysis`)
          .then((r) => {
            setAnalysis(Object.fromEntries(r.questions.map((x) => [x.questionId, x])));
            setOpenReports(r.openReports);
          })
          .catch(() => undefined);
        api<{ reports: typeof reports }>("GET", `quizzes/${itemId}/reports`).then((r) => setReports(r.reports)).catch(() => undefined);
      }
    } catch (e) {
      fail(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, itemId]);
  useEffect(() => void load(), [load]);

  async function start(practice: boolean, restart = false) {
    setError(null);
    try {
      const a = await api<Attempt>("POST", `quizzes/${itemId}/attempts`, { ...(practice ? { mode: "practice" } : {}), restart, includeDrafts: editor && !published, ...(display.extraTime ? { extraTimePct: display.extraTime } : {}) });
      router.push(`/attempts/${a.id}${returnTo ? `?back=${encodeURIComponent(returnTo)}` : ""}`);
    } catch (e) {
      fail(e instanceof ApiError && e.code === "no_questions" ? new ApiError(409, "no_questions", ["There are no published questions yet."]) : e);
    }
  }

  async function saveConfig(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const m = String(f.get("mode")) as Mode;
    try {
      await api("PUT", `quizzes/${itemId}/config`, {
        mode: m,
        timeLimitSeconds: f.get("minutes") ? Math.round(Number(f.get("minutes")) * 60) : null,
        questionCount: f.get("count") ? Number(f.get("count")) : null,
        shuffleQuestions: f.get("shuffleQ") === "on",
        shuffleOptions: f.get("shuffleO") === "on",
        calculator: f.get("calc") === "on",
        scoringProfileId: String(f.get("profile")) || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await load();
    } catch (err) {
      fail(err);
    }
  }

  if (!cfg) return error ? <p role="alert" className="text-danger">{error}</p> : null;
  const open = attempts.find((a) => a.status === "in_progress");
  const timed = cfg.mode !== "practice";
  const word = t("quiz").toLowerCase();

  return (
    <section className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="space-y-3 rounded-md border border-line p-4">
        <p className="text-sm text-muted">
          {cfg.publishedQuestions} {cfg.publishedQuestions === 1 ? "question" : "questions"} · {MODE_LABEL[cfg.mode]}
          {timed && cfg.timeLimitSeconds ? ` · ${formatClock(cfg.timeLimitSeconds * 1000)} limit` : ""}
          {cfg.questionCount ? ` · ${cfg.questionCount} per attempt` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          {open ? (
            <>
              <Button onClick={() => router.push(`/attempts/${open.id}${returnTo ? `?back=${encodeURIComponent(returnTo)}` : ""}`)}>Resume attempt</Button>
              <Button variant="quiet" onClick={() => confirm("Abandon the open attempt and start again?") && start(false, true)}>
                Start over
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => start(!timed)} disabled={!cfg.publishedQuestions && !editor}>
                {timed ? `Start ${MODE_LABEL[cfg.mode].toLowerCase()}` : "Start practice"}
              </Button>
              {timed && (
                <Button variant="quiet" onClick={() => start(true)}>
                  Practice without the clock
                </Button>
              )}
            </>
          )}
        </div>
        {timed && !open && <p className="text-xs text-muted">The clock runs on the server. Closing the page does not stop it.</p>}
      </div>

      {attempts.length > 0 && (
        <div>
          <h2 className="mb-2 text-xl">Your attempts</h2>
          <ScoreTrend attempts={attempts} />
          <ul className="divide-y divide-line rounded-md border border-line text-sm">
            {attempts.map((a) => (
              <li key={a.id}>
                <Link href={`/attempts/${a.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-surface">
                  <span>
                    {new Date(a.startedAt).toLocaleString()} · {MODE_LABEL[a.mode]}
                  </span>
                  <span className="text-muted">{a.status === "in_progress" ? "In progress" : a.result ? `${a.result.scaled ?? pct(a.result.rawBp)} · ${a.result.pass ? "pass" : "not yet"}` : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editor && (
        <>
          <form onSubmit={saveConfig} className="space-y-3 rounded-md border border-line p-4">
            <h2 className="text-xl">Settings</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="cfg-mode" className="text-sm text-muted">
                  Mode
                </label>
                <select id="cfg-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                  {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABEL[m]}
                    </option>
                  ))}
                </select>
              </div>
              <Field id="cfg-min" name="minutes" label="Time limit (minutes)" type="number" min={1} max={480} defaultValue={cfg.timeLimitSeconds ? cfg.timeLimitSeconds / 60 : ""} required={mode !== "practice"} />
              <Field id="cfg-count" name="count" label="Questions per attempt (blank for all)" type="number" min={1} max={500} defaultValue={cfg.questionCount ?? ""} />
              <div className="space-y-1">
                <label htmlFor="cfg-profile" className="text-sm text-muted">
                  Scoring profile
                </label>
                <select id="cfg-profile" name="profile" defaultValue={cfg.scoringProfileId ?? ""} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                  <option value="">Default (simple percent)</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({FIDELITY_LABEL[p.fidelity]})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="shuffleQ" defaultChecked={cfg.shuffleQuestions} /> Shuffle question order
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="shuffleO" defaultChecked={cfg.shuffleOptions} /> Shuffle answer options
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="calc" defaultChecked={!!cfg.calculator} /> Offer an on-screen calculator
            </label>
            <div className="flex items-center gap-3">
              <Button type="submit">Save settings</Button>
              <Link href="/scoring" className="text-sm text-accent underline">
                Scoring profiles
              </Link>
              {saved && <span role="status" className="text-sm text-muted">Saved.</span>}
            </div>
          </form>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl">Questions</h2>
              <Button onClick={() => setEditing("new")}>
                <Plus size={16} /> Add question
              </Button>
            </div>
            {editing === "new" && (
              <QuestionEditor
                itemId={itemId}
                archiveId={archiveId}
                onCancel={() => setEditing(null)}
                onSaved={async () => {
                  setEditing(null);
                  await load();
                }}
              />
            )}
            {reports.length > 0 && (
              <div className="space-y-2 rounded-md border border-line p-4">
                <h3 className="text-base">Reported by learners ({reports.length})</h3>
                <ul className="space-y-2 text-sm">
                  {reports.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{r.stem}</span>
                        <span className="text-muted">
                          {r.kind.replaceAll("_", " ")}
                          {r.message ? `: ${r.message}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-3">
                        <button onClick={() => setEditing(r.questionId)} className="text-accent underline">
                          Edit question
                        </button>
                        <button
                          onClick={async () => {
                            await api("POST", `reports/${r.id}/resolve`, {}).catch(fail);
                            await load();
                          }}
                          className="text-accent underline"
                        >
                          Resolve
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {drafts.length > 1 && (
              <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
                {drafts.length} questions are drafts.
                <Button variant="quiet" onClick={publishAllDrafts}>
                  Publish all {drafts.length}
                </Button>
              </p>
            )}
            {questions.length > 8 && (
              <div className="flex flex-wrap gap-2">
                <label className="sr-only" htmlFor="q-find">
                  Filter questions
                </label>
                <input id="q-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={`Filter ${questions.length} questions`} className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-ink" />
                {areas.length > 0 && (
                  <>
                    <label className="sr-only" htmlFor="q-area">
                      Domain
                    </label>
                    <select id="q-area" value={area} onChange={(e) => setArea(e.target.value)} className="rounded-md border border-line bg-surface px-3 py-2 text-ink">
                      <option value="">All domains</option>
                      {areas.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}
            <ul className="divide-y divide-line rounded-md border border-line">
              {questions.length === 0 && <li className="p-4 text-muted">No questions yet. This {word} cannot be attempted until you add some.</li>}
              {questions.length > 0 && shownQuestions.length === 0 && <li className="p-4 text-muted">No question matches that filter.</li>}
              {shownQuestions.map((q) => (
                <li key={q.id} className="p-3">
                  {editing === q.id ? (
                    <QuestionEditor
                      itemId={itemId}
                      archiveId={archiveId}
                      initial={q}
                      onCancel={() => setEditing(null)}
                      onSaved={async () => {
                        setEditing(null);
                        await load();
                      }}
                    />
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{q.stem}</p>
                        <p className="text-xs text-muted">
                          {TYPE_LABEL[q.type]} · {q.weight} {q.weight === 1 ? "mark" : "marks"}
                          {q.domain ? ` · ${q.domain}` : ""}
                          {q.isPretest ? " · unscored" : ""}
                          {q.status === "draft" ? ` · draft (${q.source})` : ""}
                        </p>
                        {analysis[q.id] && (
                          <p className="text-xs text-muted">
                            {analysis[q.id]!.answers} {analysis[q.id]!.answers === 1 ? "answer" : "answers"} from {analysis[q.id]!.people} {analysis[q.id]!.people === 1 ? "person" : "people"} · {pct(analysis[q.id]!.correctBp)} correct
                            {analysis[q.id]!.avgMs ? ` · about ${Math.round(analysis[q.id]!.avgMs! / 1000)}s` : ""}
                            {analysis[q.id]!.answers >= 10 && analysis[q.id]!.correctBp < 3000 ? " · very few get this right, check the key" : ""}
                            {analysis[q.id]!.answers >= 10 && analysis[q.id]!.correctBp > 9500 ? " · almost everyone gets this right" : ""}
                          </p>
                        )}
                        {openReports[q.id] ? <p className="text-xs text-danger">{openReports[q.id]} open {openReports[q.id] === 1 ? "report" : "reports"}</p> : null}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {q.status === "draft" && (
                          <Button
                            variant="quiet"
                            onClick={async () => {
                              await api("PATCH", `questions/${q.id}`, { status: "published" }).catch(fail);
                              await load();
                            }}
                          >
                            Publish
                          </Button>
                        )}
                        <Button variant="quiet" aria-label="Edit question" onClick={() => setEditing(q.id)}>
                          <Pencil size={14} />
                        </Button>
                        <Button
                          variant="quiet"
                          aria-label="Delete question"
                          onClick={async () => {
                            if (!confirm("Delete this question? Past attempts keep their own copy.")) return;
                            await api("DELETE", `questions/${q.id}`).catch(fail);
                            await load();
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

/** Raw score of each finished attempt, oldest first, with how the latest compares. Attempts arrive newest first. */
function ScoreTrend({ attempts }: { attempts: Attempt[] }) {
  const scored = attempts.filter((a) => a.status !== "in_progress" && a.result && a.result.rawBp !== null).reverse();
  if (scored.length < 2) return null;
  const bps = scored.map((a) => a.result!.rawBp as number);
  const latest = bps[bps.length - 1]!;
  const change = latest - bps[bps.length - 2]!;
  const best = Math.max(...bps);
  const delta = change === 0 ? "same as the attempt before" : `${change > 0 ? "up" : "down"} ${pct(Math.abs(change))} from the attempt before`;
  return (
    <div className="mb-3 space-y-1">
      <p className="text-sm text-muted">
        Latest {pct(latest)}, {delta}. Best {pct(best)}.
      </p>
      {best > 0 && <BarChart data={scored.map((a, i) => ({ label: `Attempt ${i + 1}`, value: bps[i]! }))} max={10000} label={`Score of your last ${scored.length} attempts, oldest to newest`} />}
    </div>
  );
}
