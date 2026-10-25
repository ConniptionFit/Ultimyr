"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loading } from "@/components/loading";
import { FocusButton } from "@/components/focus-button";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { clozeSides } from "@/lib/cloze";
import { useDisplay } from "@/lib/display";
import { checkTyped, expectedAnswer } from "@/lib/typed-answer";
import { useNaming } from "@/lib/naming";
import { formatNext, isLeech, sessionSummary, type ReviewNote, type StudyCard, type StudyQueue } from "@/lib/progress";

const RATINGS = [
  { n: 1, label: "Again", hint: "rateAgain" },
  { n: 2, label: "Hard", hint: "rateHard" },
  { n: 3, label: "Good", hint: "rateGood" },
  { n: 4, label: "Easy", hint: "rateEasy" },
] as const;

interface CardHistory {
  schedule: { reps: number; lapses: number; stabilityDays: number; difficulty: number; due: string; recallChance: number | null } | null;
  reviews: { rating: number; wasNew: boolean; daysSincePrevious: number | null; scheduledDays: number; at: string }[];
}
const RATING_NAME = ["", "Again", "Hard", "Good", "Easy"];

/** What the scheduler knows about one card, so a card that keeps coming back can be understood. */
function CardInfo({ h }: { h: CardHistory }) {
  if (!h.schedule) return <p className="text-xs text-muted">You have not reviewed this card yet.</p>;
  const sc = h.schedule;
  return (
    <div className="space-y-2 rounded-md bg-surface p-3 text-xs text-muted">
      <p>
        Seen {sc.reps} times, forgotten {sc.lapses}. Memory lasts about {sc.stabilityDays} days. Difficulty {sc.difficulty} of 10.
        {sc.recallChance !== null ? ` Chance you remember it now: ${Math.round(sc.recallChance * 100)}%.` : ""} Next due {new Date(sc.due).toLocaleDateString()}.
      </p>
      <ul className="max-h-32 space-y-0.5 overflow-auto">
        {h.reviews.map((r) => (
          <li key={r.at}>
            {new Date(r.at).toLocaleDateString()} · {RATING_NAME[r.rating]}
            {r.wasNew ? " (first time)" : r.daysSincePrevious !== null ? ` after ${r.daysSincePrevious} days` : ""} · next in {r.scheduledDays} days
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The spaced-repetition queue: due cards first, then new ones. Used by the Study page and inside a path step. */
export function StudyQueuePanel({ archive, deck, embedded = false, onCaughtUp }: { archive: string | null; deck: string | null; embedded?: boolean; onCaughtUp?: () => void }) {
  const { state, api } = useAuth();
  const { t, copy } = useNaming();
  const { display } = useDisplay();
  const router = useRouter();
  const [queue, setQueue] = useState<StudyCard[] | null>(null);
  const [counts, setCounts] = useState<StudyQueue["counts"] | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [last, setLast] = useState<{ card: StudyCard; reviewId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Study ahead" pulls in cards due within the next few days, for the stretch before an exam.
  const [ahead, setAhead] = useState(0);
  const [info, setInfo] = useState<CardHistory | "loading" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  // "Type the answer" is a per-browser choice: it asks you to recall before you peek.
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  useEffect(() => {
    try {
      setTyping(localStorage.getItem("ulti.typeAnswers") === "1");
    } catch {}
  }, []);
  const toggleTyping = (on: boolean) => {
    setTyping(on);
    try {
      localStorage.setItem("ulti.typeAnswers", on ? "1" : "0");
    } catch {}
  };

  const load = useCallback(async () => {
    const qs = [archive && `archive=${archive}`, deck && `deck=${deck}`, ahead && `ahead=${ahead}`].filter(Boolean).join("&");
    try {
      const q = await api<StudyQueue>("GET", `study/queue${qs ? `?${qs}` : ""}`);
      setQueue(q.cards);
      setCounts(q.counts);
      setShown(false);
      shownAt.current = Date.now();
    } catch {
      setError("Could not load your cards.");
    }
  }, [api, archive, deck, ahead]);

  async function showInfo(id: string) {
    setInfo("loading");
    try {
      setInfo(await api<CardHistory>("GET", `study/cards/${id}/history`));
    } catch {
      setInfo(null);
      setError("Could not load that card's history.");
    }
  }

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status === "authenticated") void load();
  }, [state.status, router, load]);

  const card = queue?.[0];
  useEffect(() => {
    setTyped("");
  }, [card?.id]);
  const sides = card ? clozeSides(card.front, card.back) : null;
  const verdict = card && shown && typing ? checkTyped(typed, expectedAnswer(card.front, card.back)) : null;

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card) return;
      try {
        const res = await api<{ reviewId?: string; leech?: boolean; suspended?: boolean }>("POST", "study/review", { cardId: card.id, rating, durationMs: Date.now() - shownAt.current });
        setLast(res.reviewId ? { card, reviewId: res.reviewId } : null);
        setNotice(res.suspended ? "That card keeps slipping, so it is suspended. Find it in Your settings > Flashcards." : null);
      } catch {
        return setError("Could not save that review. Try again.");
      }
      setError(null);
      setDone((n) => n + 1);
      const ms = Date.now() - shownAt.current;
      setNotes((l) => [...l, { rating, ms }]);
      // Cards you missed come back in a minute or ten: keep them in this session.
      const again = rating <= 2 && card.next[String(rating) as "1" | "2"].days === 0;
      setQueue((q) => (q ? [...q.slice(1), ...(again ? [{ ...card, state: 1 }] : [])] : q));
      setShown(false);
      shownAt.current = Date.now();
    },
    [api, card],
  );

  /** Take the current card out of today's queue (bury) or out of rotation until you bring it back (suspend). */
  const hide = useCallback(
    async (how: "bury" | "suspend") => {
      if (!card) return;
      try {
        await api("POST", `study/cards/${card.id}/${how}`, how === "suspend" ? { suspended: true } : { tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
      } catch {
        return setError("Could not do that. Try again.");
      }
      setError(null);
      setNotice(how === "bury" ? "Buried until tomorrow." : "Suspended. You can bring it back in Your settings > Flashcards.");
      setQueue((q) => (q ? q.filter((c) => c.id !== card.id) : q));
      setLast(null);
      setShown(false);
      shownAt.current = Date.now();
    },
    [api, card],
  );

  const undo = useCallback(async () => {
    if (!last) return;
    try {
      await api("POST", "study/review/undo", { reviewId: last.reviewId });
    } catch {
      setLast(null);
      return setError("That rating can no longer be undone.");
    }
    setError(null);
    setDone((n) => Math.max(0, n - 1));
    setNotes((l) => l.slice(0, -1));
    // Put the card back first, and drop the copy a missed card queued for later in this session.
    setQueue((q) => [last.card, ...(q ?? []).filter((c) => c.id !== last.card.id)]);
    setLast(null);
    setShown(false);
    shownAt.current = Date.now();
  }, [api, last]);

  // Keyboard: space shows the answer, 1 to 4 rate, U undoes the last rating.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === " " && !shown) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) void rate(Number(e.key) as 1 | 2 | 3 | 4);
      else if (e.key.toLowerCase() === "u" && !e.ctrlKey && !e.metaKey && !e.altKey) void undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, rate, undo]);

  // In a path step, finishing the queue counts as finishing the step.
  const caught = useRef(onCaughtUp);
  caught.current = onCaughtUp;
  const finished = queue !== null && !card && done > 0;
  useEffect(() => {
    if (finished) caught.current?.();
  }, [finished]);

  if (!queue) return error ? <p role="alert">{error}</p> : <Loading />;
  return (
    <div className="ulti-fade space-y-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            {embedded ? <h3 className="text-lg">{t("queue")}</h3> : <h1 className="text-3xl">{t("queue")}</h1>}
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted">
                {done} done · {queue.length} left
              </p>
              {!embedded && <FocusButton />}
            </div>
          </div>
          {!embedded && (archive || deck) && (
            <p className="text-sm text-muted">
              Showing {deck ? "one deck" : "one course"} only.{" "}
              <button onClick={() => router.push("/study")} className="text-accent underline">
                Review everything that is due
              </button>
            </p>
          )}
          {done + queue.length > 0 && (
            <div role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={done + queue.length} aria-valuenow={done} className="h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round((done / (done + queue.length)) * 100)}%` }} />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-muted">
              {notice}
            </p>
          )}
          {last && (
            <p className="text-sm">
              <button onClick={undo} className="text-accent underline">
                Undo last rating<span className="hidden md:inline"> (U)</span>
              </button>
            </p>
          )}
          {!card ? (
            <div className="space-y-3 rounded-md border border-line p-6">
              <p className="text-xl">{done ? copy("caughtUp") : copy("nothingDue")}</p>
              {done > 0 && <p className="text-sm">{sessionSummary(notes)}</p>}
              <p className="text-muted">
                {counts && counts.newAllowanceLeft === 0 ? "You have reached today's limit of new cards. " : ""}
                Cards come back when it is time to see them again.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => router.push(`/progress${archive ? `?archive=${archive}` : ""}`)}>See progress</Button>
                <Button variant="quiet" onClick={load}>
                  Check again
                </Button>
                {[3, 7].filter((d) => d > ahead).map((d) => (
                  <Button key={d} variant="quiet" onClick={() => setAhead(d)}>
                    Study ahead {d} days
                  </Button>
                ))}
              </div>
              {ahead > 0 && <p className="text-xs text-muted">Studying ahead looks {ahead} days forward. Cards reviewed early are rescheduled as usual, so nothing is lost.</p>}
            </div>
          ) : (
            <section aria-label="Flashcard" className="space-y-4">
              <p className="text-xs text-muted">
                {card.deckId ? (
                  <Link href={`/items/${card.deckId}`} className="underline">
                    {card.deckTitle}
                  </Link>
                ) : (
                  card.deckTitle
                )}
                {card.state === 0 ? " · new" : ""}
              </p>
              <div key={`${card.id}:${shown}`} className={`min-h-40 space-y-4 rounded-md border border-line p-6${display.flip && shown ? " ulti-flip" : ""}`}>
                <div className="text-xl">
                  <Markdown>{sides!.front}</Markdown>
                </div>
                {card.hint && !shown && <p className="text-sm text-muted">Hint: {card.hint}</p>}
                {typing && !shown && (
                  <textarea
                    aria-label="Type your answer"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        setShown(true);
                      }
                    }}
                    rows={2}
                    placeholder="Type your answer, then press Enter"
                    className="w-full rounded-md border border-line bg-bg p-2 text-base"
                  />
                )}
                {verdict && verdict !== "empty" && (
                  <p role="status" className={`text-sm ${verdict === "different" ? "text-danger" : "text-muted"}`}>
                    You typed: <span className="font-mono">{typed}</span>.{" "}
                    {verdict === "match" ? "That matches. Good is a fair rating." : verdict === "close" ? "Very close, likely a typo. Good is a fair rating." : "That does not match, so Again or Hard may fit. You are the judge."}
                  </p>
                )}
                {shown && (
                  <div className="border-t border-line pt-4" aria-live="polite">
                    <Markdown>{sides!.back}</Markdown>
                  </div>
                )}
                {shown && isLeech(card) && (
                  <p className="rounded-md bg-surface p-3 text-sm text-muted">
                    You have forgotten this card {card.lapses} times. It may help to say the answer in your own words, tie it to a picture, or ask the author to split it into smaller cards.
                  </p>
                )}
              </div>
              {!shown ? (
                <Button onClick={() => setShown(true)}>
                  Show answer<span className="hidden font-normal md:inline"> (space)</span>
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">{copy("rateQuestion")}</p>
                  <p className="text-xs text-muted">{copy("rateExplain")}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={copy("rateQuestion")}>
                    {RATINGS.map((r) => (
                      <Button key={r.n} variant={r.n === 3 ? "primary" : "quiet"} onClick={() => rate(r.n)} className="h-auto flex-col gap-0.5 py-2">
                        <span>
                          {r.label} <span className={`hidden text-xs md:inline${r.n === 3 ? "" : " opacity-70"}`}>({r.n})</span>
                        </span>
                        <span className={`text-xs font-normal${r.n === 3 ? "" : " opacity-80"}`}>{copy(r.hint)}</span>
                        <span className="text-xs">Next: {formatNext(card.next[String(r.n) as "1" | "2" | "3" | "4"])}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <p className="flex flex-wrap gap-4 text-xs text-muted">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={typing} onChange={(e) => toggleTyping(e.target.checked)} /> Type the answer
                </label>
                <button onClick={() => hide("bury")} className="underline">
                  Bury until tomorrow
                </button>
                <button onClick={() => hide("suspend")} className="underline">
                  Suspend this card
                </button>
                <button onClick={() => (info ? setInfo(null) : void showInfo(card.id))} className="underline" aria-expanded={info !== null}>
                  Card info
                </button>
              </p>
              {info === "loading" && <p className="text-xs text-muted">Loading</p>}
              {info && info !== "loading" && <CardInfo h={info} />}
            </section>
          )}
    </div>
  );
}

