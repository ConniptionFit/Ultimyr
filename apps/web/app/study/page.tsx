"use client";

import { StatusIcon } from "@ultimyr/ui-icons";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Header } from "@/components/header";
import { Markdown } from "@/components/markdown";
import { Button, Shell } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { formatNext, type StudyCard, type StudyQueue } from "@/lib/progress";

const RATINGS = [
  { n: 1, label: "Again" },
  { n: 2, label: "Hard" },
  { n: 3, label: "Good" },
  { n: 4, label: "Easy" },
] as const;

function Study() {
  const { state, api } = useAuth();
  const { t } = useNaming();
  const router = useRouter();
  const params = useSearchParams();
  const archive = params.get("archive");
  const deck = params.get("deck");
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

  if (!queue) {
    return (
      <>
        <Header />
        <Shell>{error ? <p role="alert">{error}</p> : <StatusIcon status="loading" size={22} />}</Shell>
      </>
    );
  }
  return (
    <>
      <Header />
      <Shell>
        <div className="ulti-fade space-y-6">
          <div className="flex items-baseline justify-between">
            <h1 className="text-3xl">{t("queue")}</h1>
            <p className="text-sm text-muted">
              {done} done · {queue.length} left
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {!card ? (
            <div className="space-y-3 rounded-md border border-line p-6">
              <p className="text-xl">{done ? "That is everything for now." : "Nothing is due."}</p>
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
              <div className="min-h-40 space-y-4 rounded-md border border-line p-6">
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="How well did you remember?">
                  {RATINGS.map((r) => (
                    <Button key={r.n} variant={r.n === 3 ? "primary" : "quiet"} onClick={() => rate(r.n)} className="flex-col">
                      <span>
                        {r.label} <span className="text-xs opacity-70">({r.n})</span>
                      </span>
                      <span className="text-xs opacity-80">{formatNext(card.next[String(r.n) as "1" | "2" | "3" | "4"])}</span>
                    </Button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </Shell>
    </>
  );
}

export default function StudyPage() {
  return (
    <Suspense>
      <Study />
    </Suspense>
  );
}
