"use client";

import { Flag } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantPanel } from "@/components/assistant-panel";
import { Loading } from "@/components/loading";
import { FocusButton } from "@/components/focus-button";
import { Header } from "@/components/header";
import { FeedbackView, QuestionView } from "@/components/quiz/question-view";
import { Button, Shell } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { REASON_LABEL } from "@/lib/certs";
import { FIDELITY_LABEL, MODE_LABEL, formatClock, pct, timeNotice, type Attempt, type PlayQuestion } from "@/lib/quiz";

const answered = (q: PlayQuestion) => q.response !== null && q.response !== undefined && JSON.stringify(q.response) !== "{}";

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const { state, api } = useAuth();
  const { t, copy } = useNaming();
  const router = useRouter();
  const [at, setAt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const skew = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const shownAt = useRef(Date.now());
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await api<Attempt>("GET", `attempts/${id}`);
      if (a.serverTime) skew.current = new Date(a.serverTime).getTime() - Date.now();
      setAt(a);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "We could not find that attempt." : "Could not load the attempt.");
    }
  }, [api, id]);

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status === "authenticated") void load();
  }, [state.status, router, load]);

  // Cosmetic clock: the server decides when time is up, this only shows it.
  const open = at?.status === "in_progress";
  useEffect(() => {
    if (!open) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [open]);
  const remaining = at?.deadlineAt ? new Date(at.deadlineAt).getTime() - (now + skew.current) : null;
  useEffect(() => {
    if (open && remaining !== null && remaining <= -1000) void load(); // ask the server to close it
  }, [open, remaining, load]);

  // Screen readers hear the time left once at the start and again at 30, 15, 10, 5 and 1 minutes (the clock itself stays silent).
  const [notice, setNotice] = useState("");
  const lastMinute = useRef<number | null>(null);
  const minutesLeft = open && remaining !== null ? Math.ceil(remaining / 60_000) : null;
  useEffect(() => {
    if (minutesLeft === null) return;
    const said = timeNotice(lastMinute.current, minutesLeft);
    lastMinute.current = minutesLeft;
    if (said) setNotice(said);
  }, [minutesLeft]);

  // Ask the server for its clock: corrects the display and tells us at once when time is up.
  const token = state.status === "authenticated" ? state.accessToken : null;
  const timed = open && !!at?.deadlineAt;
  useEffect(() => {
    if (!timed || !token) return;
    const ctl = new AbortController();
    (async () => {
      while (!ctl.signal.aborted) {
        try {
          const res = await fetch(`/api/v1/attempts/${id}/events`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal });
          if (!res.ok || !res.body) return; // fall back to the clock we already have
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done: end } = await reader.read();
            if (end) break;
            buf += dec.decode(value, { stream: true });
            let cut: number;
            while ((cut = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, cut);
              buf = buf.slice(cut + 2);
              const ev = /^event: (.+)$/m.exec(block)?.[1];
              const data = /^data: (.+)$/m.exec(block)?.[1];
              if (!ev || !data) continue;
              const j = JSON.parse(data) as { serverTime?: string };
              if (j.serverTime) skew.current = new Date(j.serverTime).getTime() - Date.now();
              if (ev === "closed") return void load();
            }
          }
        } catch {
          if (ctl.signal.aborted) return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => ctl.abort();
  }, [timed, token, id, load]);

  const q = at?.questions?.[idx];
  const patchLocal = (qid: string, p: Partial<PlayQuestion>) => setAt((a) => (a ? { ...a, questions: a.questions!.map((x) => (x.id === qid ? { ...x, ...p } : x)) } : a));

  const save = useCallback(
    (qid: string, body: Record<string, unknown>) => api("PUT", `attempts/${id}/items/${qid}`, body).catch((e) => {
      if (e instanceof ApiError && e.code === "attempt_closed") return load();
      if (e instanceof ApiError && e.code === "already_revealed") return undefined; // a checked answer is final
      setError("Could not save your answer. Check your connection.");
    }),
    [api, id, load],
  );
  const flush = (qid: string) => {
    const timeMs = Date.now() - shownAt.current;
    shownAt.current = Date.now();
    void save(qid, { timeMs });
  };
  const go = (n: number) => {
    if (q && open) flush(q.id);
    setIdx(n);
  };

  function answer(qid: string, response: unknown) {
    patchLocal(qid, { response });
    clearTimeout(timers.current.get(qid));
    timers.current.set(
      qid,
      setTimeout(() => {
        timers.current.delete(qid);
        void save(qid, { response });
      }, 400),
    );
  }

  async function submit() {
    if (!at?.questions) return;
    setReviewing(false);
    for (const [qid, timer] of [...timers.current]) {
      clearTimeout(timer);
      timers.current.delete(qid);
      const x = at.questions.find((y) => y.id === qid);
      if (x) await save(qid, { response: x.response });
    }
    try {
      await api("POST", `attempts/${id}/submit`);
      await load();
      setIdx(0);
    } catch {
      setError("Could not submit. Try again.");
    }
  }

  /** Practice mode: save the answer, then ask the server to grade this one question. */
  async function checkNow(question: PlayQuestion) {
    clearTimeout(timers.current.get(question.id));
    timers.current.delete(question.id);
    if (question.response !== null && question.response !== undefined) await save(question.id, { response: question.response });
    const feedback = await api<PlayQuestion["feedback"]>("POST", `attempts/${id}/items/${question.id}/check`).catch(() => undefined);
    if (feedback) patchLocal(question.id, { feedback });
  }

  // Keyboard: N next, P previous, F flag, C check (practice), 1 to 9 pick an option. Ignored while typing or when a modifier is held.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    const el = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || reviewing || !at?.questions || !q) return;
    if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) && !(el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox"))) return;
    const k = e.key.toLowerCase();
    const n = at.questions.length;
    if (k === "n" && idx < n - 1) go(idx + 1);
    else if (k === "p" && idx > 0) go(idx - 1);
    else if (k === "c" && open && at.mode === "practice" && !q.feedback) void checkNow(q);
    else if (k === "f" && open) {
      patchLocal(q.id, { flagged: !q.flagged });
      void save(q.id, { flagged: !q.flagged });
    } else if (/^[1-9]$/.test(k) && open && !q.feedback && (q.type === "mcq" || q.type === "multi")) {
      const o = q.payload.options?.[Number(k) - 1] as { id: string } | undefined;
      if (!o) return;
      if (q.type === "mcq") answer(q.id, { choice: o.id });
      else {
        const chosen: string[] = q.response?.choices ?? [];
        answer(q.id, { choices: chosen.includes(o.id) ? chosen.filter((c) => c !== o.id) : [...chosen, o.id] });
      }
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const summary = useMemo(() => at?.result, [at]);

  if (state.status !== "authenticated" || (!at && !error)) {
    return (
      <>
        <Header />
        <Shell>
          <Loading />
        </Shell>
      </>
    );
  }
  if (!at || !at.questions) {
    return (
      <>
        <Header />
        <Shell>
          <p role="alert">{error}</p>
        </Shell>
      </>
    );
  }
  const closed = at.status !== "in_progress";
  const qs = at.questions;
  const low = remaining !== null && remaining < 60_000;
  const drill = at.kind === "drill";
  // A quiz opened from the path comes back to the path (same-site addresses only).
  const back = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("back");
  const fromPath = back && back.startsWith("/") && !back.startsWith("//") && !back.includes("\\") ? back : null;
  const missedCount = qs.filter((x) => x.feedback && (x.feedback.outcome === "incorrect" || x.feedback.outcome === "partial")).length;
  async function redoMissed() {
    if (!at) return;
    try {
      const d = await api<{ id: string }>("POST", "drills", { archiveId: at.archiveId, focus: "missed", count: Math.min(50, Math.max(3, missedCount)), restart: true });
      router.push(`/attempts/${d.id}`);
    } catch {
      setError("Could not start a drill of your missed questions.");
    }
  }
  const home = fromPath ?? (drill ? `/archives/${at.archiveId}` : `/items/${at.itemId}`);

  return (
    <>
      <Header />
      <Shell>
        <div className="ulti-fade space-y-6">
          <Link href={home} className="text-sm text-muted hover:text-ink">
            ← Back to the {fromPath ? t("roadmap").toLowerCase() : drill ? t("archive").toLowerCase() : t("quiz").toLowerCase()}
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl">
              {drill ? "Weak-area drill" : MODE_LABEL[at.mode]}
              {closed ? " results" : ""}
            </h1>
            <div className="flex items-center gap-3">
              {open && remaining !== null && (
                <p role="timer" aria-live="off" className={`font-mono text-lg ${low ? "text-danger" : ""}`}>
                  {formatClock(remaining)}
                </p>
              )}
              {open && <FocusButton />}
              <p className="sr-only" role="status" aria-live="polite">{notice}</p>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {closed && summary && (
            <section className="space-y-4 rounded-md border border-line p-5" aria-label="Result">
              <p className="text-3xl">
                {drill ? pct(summary.rawBp) : summary.scaled !== null ? summary.scaled : pct(summary.rawBp)}
                {!drill && <span className={`ml-3 text-base ${summary.pass ? "text-accent" : "text-danger"}`}>{summary.pass ? "Pass" : "Not yet"}</span>}
              </p>
              <p className="text-sm text-muted">
                {pct(summary.rawBp)} of marks ({summary.earned / 1000} of {summary.max / 1000}). {summary.counts.correct} correct, {summary.counts.partial} partly, {summary.counts.incorrect} incorrect, {summary.counts.unanswered} unanswered.
                {at.status === "expired" ? " Time ran out, so this was graded as it stood at the deadline." : ""}
              </p>
              {summary.counts.incorrect + summary.counts.partial > 0 && <p className="text-sm">{copy("attemptGap")}</p>}
              {drill ? (
                <p className="text-xs text-muted">A drill is built from the questions you miss most, so it is meant to feel harder than the real thing. It does not change your readiness estimate.</p>
              ) : (
                <p className="text-xs text-muted">
                  {at.extraTimePct ? `Taken with ${at.extraTimePct}% extra time. ` : ""}Scored with “{at.profile.name}” ({FIDELITY_LABEL[at.profile.fidelity]}).
                  {at.profile.fidelity !== "published_formula" && " This is not an official exam score."}
                </p>
              )}
              {summary.domains.length > 1 && (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th scope="col" className="py-1 font-normal">Domain</th>
                      <th scope="col" className="py-1 font-normal">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.domains.map((d) => (
                      <tr key={d.domain} className="border-t border-line">
                        <td className="py-1">{d.domain}</td>
                        <td className="py-1">
                          {pct(d.bp)} {d.met === false && <span className="text-danger">below the minimum</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {(() => {
                const missed = qs.flatMap((x, i) => (x.feedback && x.feedback.outcome !== "correct" && x.feedback.outcome !== "excluded" ? [i] : []));
                return missed.length > 0 ? (
                  <p className="text-sm">
                    Review what you missed:{" "}
                    {missed.map((i) => (
                      <button key={i} className="mr-2 text-accent underline" onClick={() => { go(i); document.getElementById("question-area")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                        {i + 1}
                      </button>
                    ))}
                  </p>
                ) : null;
              })()}
              <AssistantPanel context={{ type: "attempt", id }} label="Explain my mistakes" />
              <div className="flex gap-2">
                <Button onClick={() => router.push(home)}>Done</Button>
                <Button variant="quiet" onClick={() => router.push(`/drills?archive=${at.archiveId}`)}>
                  {drill ? "Another drill" : "Drill my weak areas"}
                </Button>
                {missedCount > 0 && (
                  <Button variant="quiet" onClick={redoMissed}>
                    Redo what I missed
                  </Button>
                )}
              </div>
            </section>
          )}

          {open && reviewing && (
            <section aria-label="Review before submitting" className="space-y-3 rounded-md border border-line p-5">
              <h2 className="text-xl">Before you submit</h2>
              {(() => {
                const blank = qs.flatMap((x, i) => (answered(x) ? [] : [i]));
                const flagged = qs.flatMap((x, i) => (x.flagged ? [i] : []));
                const jump = (list: number[]) =>
                  list.map((i) => (
                    <button key={i} className="mr-2 text-accent underline" onClick={() => { setReviewing(false); go(i); }}>
                      {i + 1}
                    </button>
                  ));
                return (
                  <>
                    <p className="text-sm">{blank.length ? <>Unanswered: {jump(blank)}</> : "Every question has an answer."}</p>
                    <p className="text-sm">{flagged.length ? <>Flagged for review: {jump(flagged)}</> : "Nothing is flagged."}</p>
                  </>
                );
              })()}
              <div className="flex gap-2">
                <Button onClick={submit}>Submit now</Button>
                <Button variant="quiet" onClick={() => setReviewing(false)}>
                  Keep working
                </Button>
              </div>
            </section>
          )}

          <nav aria-label="Questions" className="flex flex-wrap gap-1">
            {qs.map((x, i) => {
              const out = x.feedback?.outcome;
              const tone = closed || x.feedback ? (out === "correct" ? "border-accent" : out === "partial" ? "border-line" : "border-danger") : answered(x) ? "border-accent" : "border-line";
              return (
                <button key={x.id} onClick={() => go(i)} aria-current={i === idx ? "step" : undefined} aria-label={`Question ${i + 1}${x.flagged ? ", flagged" : ""}${answered(x) ? ", answered" : ""}`} className={`relative h-10 w-10 rounded-md border text-sm sm:h-9 sm:w-9 ${tone} ${i === idx ? "bg-surface font-medium" : ""}`}>
                  {i + 1}
                  {x.flagged && <Flag size={10} className="absolute right-0.5 top-0.5" aria-hidden />}
                </button>
              );
            })}
          </nav>

          {q && (
            <section id="question-area" className="scroll-mt-20" aria-label={`Question ${idx + 1} of ${qs.length}`}>
              <p className="mb-2 text-sm text-muted">
                Question {idx + 1} of {qs.length}
              </p>
              {drill && q.drillReason && REASON_LABEL[q.drillReason] && <p className="mb-2 text-xs text-muted">{REASON_LABEL[q.drillReason]}</p>}
              {open && <p className="mb-2 hidden text-xs text-muted md:block">Keys: 1 to 9 pick an option, N next, P previous, F flag{at.mode === "practice" ? ", C check the answer" : ""}.</p>}
              <QuestionView key={q.id} q={q} disabled={closed || !!q.feedback} onChange={(r) => answer(q.id, r)} />
              {q.feedback && <FeedbackView q={q} fb={q.feedback} />}
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <Button variant="quiet" disabled={idx === 0} onClick={() => go(idx - 1)}>
                  Previous
                </Button>
                <Button variant="quiet" disabled={idx === qs.length - 1} onClick={() => go(idx + 1)}>
                  Next
                </Button>
                {open && (
                  <Button
                    variant="quiet"
                    aria-pressed={q.flagged}
                    onClick={() => {
                      patchLocal(q.id, { flagged: !q.flagged });
                      void save(q.id, { flagged: !q.flagged });
                    }}
                  >
                    <Flag size={14} aria-hidden /> {q.flagged ? "Unflag" : "Flag for review"}
                  </Button>
                )}
                {open && at.mode === "practice" && !q.feedback && (
                  <Button
                    onClick={() => void checkNow(q)}
                  >
                    Check answer<span className="hidden opacity-70 md:inline"> (C)</span>
                  </Button>
                )}
                {open && idx === qs.length - 1 && <Button onClick={() => setReviewing(true)}>Review and submit</Button>}
              </div>
            </section>
          )}
          {open && idx !== qs.length - 1 && (
            <p className="text-sm text-muted">
              Ready?{" "}
              <button className="text-accent underline" onClick={() => setReviewing(true)}>
                Review and submit
              </button>
            </p>
          )}
        </div>
      </Shell>
    </>
  );
}
