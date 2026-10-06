"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui";
import { useNaming } from "@/lib/naming";
import { readingMinutes } from "@/lib/reading-time";
import type { Card, ItemDetail } from "@/lib/types";

export function GuideReader({ it }: { it: ItemDetail }) {
  const sections = it.sections ?? [];
  const minutes = readingMinutes(sections.map((s) => s.body).join("\n\n"));
  const [current, setCurrent] = useState<string | null>(null);

  // The contents list marks the section you are reading: the last heading that has reached the top of the window.
  useEffect(() => {
    if (sections.length < 2 || typeof IntersectionObserver === "undefined") return;
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
        const first = sections.find((s) => seen.has(s.anchor));
        if (first) setCurrent(first.anchor);
      },
      { rootMargin: "0px 0px -60% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.anchor);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sections]);
  return (
    <div className="grid gap-8 md:grid-cols-[1fr_12rem]">
      <article className="min-w-0 max-w-prose">
        {it.summary && <p className="mb-2 text-lg text-muted">{it.summary}</p>}
        {sections.length > 0 && <p className="mb-4 text-sm text-muted">About {minutes} min read</p>}
        {sections.map((s) => (
          <section key={s.anchor} id={s.anchor} className="scroll-mt-20">
            {s.heading !== "Introduction" && (
              <h2 className="group mt-8 text-2xl">
                {s.heading}
                <a
                  href={`#${s.anchor}`}
                  aria-label={`Link to ${s.heading}`}
                  title="Copy a link to this section"
                  onClick={() => void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#${s.anchor}`).catch(() => undefined)}
                  className="no-print ml-2 text-base text-muted opacity-0 focus:opacity-100 group-hover:opacity-100"
                >
                  #
                </a>
              </h2>
            )}
            <Markdown>{s.body}</Markdown>
          </section>
        ))}
        {sections.length === 0 && <p className="text-muted">Nothing here yet.</p>}
      </article>
      {sections.length > 1 && (
        <nav aria-label="Sections" className="hidden text-sm md:block">
          <ul className="sticky top-6 space-y-1 border-l border-line pl-3">
            {sections.map((s) => (
              <li key={s.anchor}>
                <a href={`#${s.anchor}`} aria-current={current === s.anchor ? "location" : undefined} className="text-muted hover:text-ink aria-[current=location]:text-ink aria-[current=location]:underline underline-offset-4">
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

/** Simple flip-through of a deck. Spaced repetition (the daily queue) arrives with the study queue. */
export function Study({ cards, onDone, onFinished }: { cards: Card[]; onDone: () => void; onFinished?: () => void }) {
  const { copy } = useNaming();
  const [order] = useState(() => [...cards].sort(() => Math.random() - 0.5));
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const c = order[i];
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const over = !c;
  useEffect(() => {
    if (over) finished.current?.();
  }, [over]);
  if (!c) {
    return (
      <div className="space-y-3 text-center">
        <p className="font-serif text-2xl">{copy("deckDone")}</p>
        <Button onClick={onDone}>Back to the deck</Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {i + 1} of {order.length}
      </p>
      <button
        onClick={() => setFlipped(!flipped)}
        className="flex min-h-48 w-full items-center justify-center rounded-lg border border-line bg-surface p-8 text-center font-serif text-2xl"
        aria-live="polite"
      >
        <span className="whitespace-pre-line">{flipped ? c.back : c.front}</span>
      </button>
      <div className="flex justify-between">
        <Button variant="quiet" onClick={onDone}>
          Stop
        </Button>
        <Button
          onClick={() => {
            if (!flipped) setFlipped(true);
            else {
              setFlipped(false);
              setI(i + 1);
            }
          }}
        >
          {flipped ? "Next" : "Show answer"}
        </Button>
      </div>
    </div>
  );
}
