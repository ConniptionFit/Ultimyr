"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { GuideReader } from "@/components/item-views";
import { StudyQueuePanel } from "@/components/study-queue";
import { QuizPanel } from "@/components/quiz/quiz-panel";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { dropOffline, loadOffline, saveOffline } from "@/lib/offline";
import type { Attempt } from "@/lib/quiz";
import { type ItemDetail } from "@/lib/types";

/** A guide, deck or quiz shown right inside its step, so the learner never leaves the path to read, drill or test. */
export function InlineItem({ itemId, returnTo, onComplete }: { itemId: string; returnTo: string; onComplete?: () => void }) {
  const { api } = useAuth();
  const { t, copy } = useNaming();
  const [it, setIt] = useState<ItemDetail | null>(null);
  const [error, setError] = useState(false);
  const [studying, setStudying] = useState(false);
  const [offline, setOffline] = useState<number | null>(null); // when the copy on screen was saved, if it is an offline copy
  const [kept, setKept] = useState(false);

  useEffect(() => {
    let live = true;
    api<ItemDetail>("GET", `items/${itemId}`)
      .then((x) => {
        if (!live) return;
        setIt(x);
        setKept(!!loadOffline(itemId));
        if (loadOffline(itemId)) saveOffline(x); // keep a copy you chose to keep up to date
      })
      .catch(() => {
        const saved = loadOffline(itemId);
        if (!live) return;
        if (saved) {
          setIt(saved.item);
          setOffline(saved.savedAt);
          setKept(true);
        } else setError(true);
      });
    return () => {
      live = false;
    };
  }, [api, itemId]);

  // A quiz you have already passed ticks its step, so coming back from an attempt needs no extra click.
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    if (!onComplete || it?.kind !== "quiz") return;
    api<{ attempts: Attempt[] }>("GET", `quizzes/${itemId}/attempts?limit=10`)
      .then((r) => r.attempts.some((a) => a.status === "submitted" && a.result?.pass) && complete.current?.())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it?.kind, itemId, api]);

  if (error) return <p role="alert" className="text-sm text-danger">Could not load this here. <Link href={`/items/${itemId}`} className="text-accent underline">Open it on its own page</Link>.</p>;
  if (!it) return <p className="text-sm text-muted">Loading…</p>;
  const cards = it.cards ?? [];
  return (
    <div className="space-y-3 rounded-md border border-line bg-surface p-4">
      {it.kind === "guide" && <GuideReader it={it} />}
      {it.kind === "deck" &&
        (studying && cards.length ? (
          <div className="space-y-3">
            <StudyQueuePanel archive={it.archive.id} deck={itemId} embedded onCaughtUp={onComplete} />
            <Button variant="quiet" onClick={() => setStudying(false)}>
              Close the cards
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {cards.length} {cards.length === 1 ? t("card").toLowerCase() : `${t("card").toLowerCase()}s`}
            </p>
            {cards.length > 0 ? <Button onClick={() => setStudying(true)}>Study here</Button> : <span className="text-sm text-muted">No cards yet.</span>}
          </div>
        ))}
      {it.kind === "quiz" && <QuizPanel itemId={itemId} archiveId={it.archive.id} editor={false} published={it.status === "published"} returnTo={returnTo} />}
      {offline && <p role="status" className="text-xs text-muted">You are reading the copy saved on {new Date(offline).toLocaleString()}. Studying cards and quizzes needs a connection.</p>}
      <p className="flex flex-wrap items-center justify-end gap-3 text-xs text-muted">
        {it.kind !== "quiz" && !offline && (
          <button
            type="button"
            className="underline hover:text-ink"
            onClick={() => {
              if (kept) {
                dropOffline(itemId);
                setKept(false);
              } else setKept(saveOffline(it));
            }}
          >
            {kept ? copy("offlineDrop") : copy("offlineKeep")}
          </button>
        )}
        <Link href={`/items/${itemId}`} className="underline hover:text-ink">
          Open on its own page
        </Link>
      </p>
    </div>
  );
}
