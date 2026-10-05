"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GuideReader, Study } from "@/components/item-views";
import { QuizPanel } from "@/components/quiz/quiz-panel";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { canEdit, type ItemDetail } from "@/lib/types";

/** A guide, deck or quiz shown right inside its step, so the learner never leaves the path to read, drill or test. */
export function InlineItem({ itemId, returnTo }: { itemId: string; returnTo: string }) {
  const { api } = useAuth();
  const { t } = useNaming();
  const [it, setIt] = useState<ItemDetail | null>(null);
  const [error, setError] = useState(false);
  const [studying, setStudying] = useState(false);

  useEffect(() => {
    let live = true;
    api<ItemDetail>("GET", `items/${itemId}`)
      .then((x) => live && setIt(x))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [api, itemId]);

  if (error) return <p role="alert" className="text-sm text-danger">Could not load this here. <Link href={`/items/${itemId}`} className="text-accent underline">Open it on its own page</Link>.</p>;
  if (!it) return <p className="text-sm text-muted">Loading…</p>;
  const cards = it.cards ?? [];
  return (
    <div className="space-y-3 rounded-md border border-line bg-surface p-4">
      {it.kind === "guide" && <GuideReader it={it} />}
      {it.kind === "deck" &&
        (studying && cards.length ? (
          <Study cards={cards} onDone={() => setStudying(false)} />
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {cards.length} {cards.length === 1 ? t("card").toLowerCase() : `${t("card").toLowerCase()}s`}
            </p>
            {cards.length > 0 ? <Button onClick={() => setStudying(true)}>Study here</Button> : <span className="text-sm text-muted">No cards yet.</span>}
          </div>
        ))}
      {it.kind === "quiz" && <QuizPanel itemId={itemId} archiveId={it.archive.id} editor={false} published={it.status === "published"} returnTo={returnTo} />}
      <p className="text-right text-xs text-muted">
        <Link href={`/items/${itemId}`} className="underline hover:text-ink">
          Open on its own page
        </Link>
      </p>
    </div>
  );
}
