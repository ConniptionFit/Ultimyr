"use client";

import { StatusIcon } from "@ultimyr/ui-icons";
import { Flag } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantPanel } from "@/components/assistant-panel";
import { Header } from "@/components/header";
import { FeedbackView, QuestionView } from "@/components/quiz/question-view";
import { Button, Shell } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { FIDELITY_LABEL, MODE_LABEL, formatClock, pct, type Attempt, type PlayQuestion } from "@/lib/quiz";

const answered = (q: PlayQuestion) => q.response !== null && q.response !== undefined && JSON.stringify(q.response) !== "{}";

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const { state, api } = useAuth();
  const { t } = useNaming();
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

  const summary = useMemo(() => at?.result, [at]);

  if (state.status !== "authenticated" || (!at && !error)) {
    return (
      <>
        <Header />
        <Shell>
          <StatusIcon status="loading" size={22} />
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

  return (
    <>
      <Header />
      <Shell>
        <div className="ulti-fade space-y-6">
          <Link href={`/items/${at.itemId}`} className="text-sm text-muted hover:text-ink">
            ← Back to the {t("quiz").toLowerCase()}
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl">
              {MODE_LABEL[at.mode]}
              {closed ? " results" : ""}
            </h1>
            {open && remaining !== null && (
              <p role="timer" aria-live="off" className={`font-mono text-lg ${low ? "text-danger" : ""}`}>
                {formatClock(remaining)}
              </p>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {closed && summary && (
            <section className="space-y-4 rounded-md border border-line p-5" aria-label="Result">
              <p className="text-3xl">
                {summary.scaled !== null ? summary.scaled : pct(summary.rawBp)}
                <span className={`ml-3 text-base ${summary.pass ? "text-accent" : "text-danger"}`}>{summary.pass ? "Pass" : "Not yet"}</span>
              </p>
              <p className="text-sm text-muted">
                {pct(summary.rawBp)} of marks ({summary.earned / 1000} of {summary.max / 1000}). {summary.counts.correct} correct, {summary.counts.partial} partly, {summary.counts.incorrect} incorrect, {summary.counts.unanswered} unanswered.
                {at.status === "expired" ? " Time ran out, so this was graded as it stood at the deadline." : ""}
              </p>
              <p className="text-xs text-muted">
                Scored with “{at.profile.name}” ({FIDELITY_LABEL[at.profile.fidelity]}).
                {at.profile.fidelity !== "published_formula" && " This is not an official exam score."}
              </p>
              {summary.domains.length > 1 && (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted">
                    <tr>
                      <th className="py-1 font-normal">Domain</th>
                      <th className="py-1 font-normal">Score</th>
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
              <AssistantPanel context={{ type: "attempt", id }} label="Explain my mistakes" />
              <Button onClick={() => router.push(`/items/${at.itemId}`)}>Done</Button>
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
                <button key={x.id} onClick={() => go(i)} aria-current={i === idx ? "step" : undefined} aria-label={`Question ${i + 1}${x.flagged ? ", flagged" : ""}${answered(x) ? ", answered" : ""}`} className={`relative h-9 w-9 rounded-md border text-sm ${tone} ${i === idx ? "bg-surface font-medium" : ""}`}>
                  {i + 1}
                  {x.flagged && <Flag size={10} className="absolute right-0.5 top-0.5" aria-hidden />}
                </button>
              );
            })}
          </nav>

          {q && (
            <section aria-label={`Question ${idx + 1} of ${qs.length}`}>
              <p className="mb-2 text-sm text-muted">
                Question {idx + 1} of {qs.length}
              </p>
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
                    onClick={async () => {
                      clearTimeout(timers.current.get(q.id));
                      timers.current.delete(q.id);
                      if (q.response !== null && q.response !== undefined) await save(q.id, { response: q.response });
                      const feedback = await api<PlayQuestion["feedback"]>("POST", `attempts/${id}/items/${q.id}/check`).catch(() => undefined);
                      if (feedback) patchLocal(q.id, { feedback });
                    }}
                  >
                    Check answer
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
