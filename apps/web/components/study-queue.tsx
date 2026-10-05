"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loading } from "@/components/loading";
import { FocusButton } from "@/components/focus-button";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useDisplay } from "@/lib/display";
import { useNaming } from "@/lib/naming";
import { formatNext, type StudyCard, type StudyQueue } from "@/lib/progress";

const RATINGS = [
  { n: 1, label: "Again", hint: "rateAgain" },
  { n: 2, label: "Hard", hint: "rateHard" },
  { n: 3, label: "Good", hint: "rateGood" },
  { n: 4, label: "Easy", hint: "rateEasy" },
] as const;

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
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());

  const load = useCallback(async () => {
    const qs = [archive && `archive=${archive}`, deck && `deck=${deck}`].filter(Boolean).join("&");
    try {
      const q = await api<StudyQueue>("GET", `study/queue${qs ? `?${qs}` : ""}`);
      setQueue(q.cards);
      setCounts(q.counts);
      setShown(false);
      shownAt.current = Date.now();
    } catch {
      setError("Could not load your cards.");
    }
  }, [api, archive, deck]);

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status === "authenticated") void load();
  }, [state.status, router, load]);

  const card = queue?.[0];

  const rate = useCallback(
    async (rating: 1 | 2 | 3 | 4) => {
      if (!card) return;
      try {
        await api("POST", "study/review", { cardId: card.id, rating, durationMs: Date.now() - shownAt.current });
      } catch {
        return setError("Could not save that review. Try again.");
      }
      setError(null);
      setDone((n) => n + 1);
      // Cards you missed come back in a minute or ten: keep them in this session.
      const again = rating <= 2 && card.next[String(rating) as "1" | "2"].days === 0;
      setQueue((q) => (q ? [...q.slice(1), ...(again ? [{ ...card, state: 1 }] : [])] : q));
      setShown(false);
      shownAt.current = Date.now();
    },
    [api, card],
  );

  // Keyboard: space shows the answer, 1 to 4 rate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === " " && !shown) {
        e.preventDefault();
        setShown(true);
      } else if (shown && ["1", "2", "3", "4"].includes(e.key)) void rate(Number(e.key) as 1 | 2 | 3 | 4);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, rate]);

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
          <div className="flex items-baseline justify-between">
            {embedded ? <h3 className="text-lg">{t("queue")}</h3> : <h1 className="text-3xl">{t("queue")}</h1>}
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted">
                {done} done · {queue.length} left
              </p>
              {!embedded && <FocusButton />}
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {!card ? (
            <div className="space-y-3 rounded-md border border-line p-6">
              <p className="text-xl">{done ? copy("caughtUp") : copy("nothingDue")}</p>
              <p className="text-muted">
                {counts && counts.newAllowanceLeft === 0 ? "You have reached today's limit of new cards. " : ""}
                Cards come back when it is time to see them again.
              </p>
              <div className="flex gap-2">
                <Button onClick={() => router.push(`/progress${archive ? `?archive=${archive}` : ""}`)}>See progress</Button>
                <Button variant="quiet" onClick={load}>
                  Check again
                </Button>
              </div>
            </div>
          ) : (
            <section aria-label="Flashcard" className="space-y-4">
              <p className="text-xs text-muted">{card.deckTitle}{card.state === 0 ? " · new" : ""}</p>
              <div key={`${card.id}:${shown}`} className={`min-h-40 space-y-4 rounded-md border border-line p-6${display.flip && shown ? " ulti-flip" : ""}`}>
                <div className="text-xl">
                  <Markdown>{card.front}</Markdown>
                </div>
                {card.hint && !shown && <p className="text-sm text-muted">Hint: {card.hint}</p>}
                {shown && (
                  <div className="border-t border-line pt-4" aria-live="polite">
                    <Markdown>{card.back}</Markdown>
                  </div>
                )}
              </div>
              {!shown ? (
                <Button onClick={() => setShown(true)}>Show answer (space)</Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm">{copy("rateQuestion")}</p>
                  <p className="text-xs text-muted">{copy("rateExplain")}</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label={copy("rateQuestion")}>
                    {RATINGS.map((r) => (
                      <Button key={r.n} variant={r.n === 3 ? "primary" : "quiet"} onClick={() => rate(r.n)} className="h-auto flex-col gap-0.5 py-2">
                        <span>
                          {r.label} <span className="text-xs opacity-70">({r.n})</span>
                        </span>
                        <span className="text-xs font-normal opacity-80">{copy(r.hint)}</span>
                        <span className="text-xs">Next: {formatNext(card.next[String(r.n) as "1" | "2" | "3" | "4"])}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
    </div>
  );
}

