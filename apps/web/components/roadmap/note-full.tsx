"use client";

import { ArrowLeft, ChevronLeft, ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { NotePane } from "./note-pane";

export interface NoteRef {
  id: string;
  title: string;
}

/** The note takes the whole page. Charms at the top lead back to the roadmap or the main menu, and on to the next or previous step. */
export function NoteFull({ archiveId, current, steps, onOpen, onClose }: { archiveId: string; current: NoteRef; steps: NoteRef[]; onOpen: (n: NoteRef) => void; onClose: () => void }) {
  const [dirty, setDirty] = useState(false);
  const i = steps.findIndex((s) => s.id === current.id);
  const go = (n: NoteRef | undefined) => {
    if (!n) return;
    if (dirty && !confirm("Leave without saving your changes to this note?")) return;
    onOpen(n);
  };
  const leave = () => {
    if (dirty && !confirm("Leave without saving your changes to this note?")) return;
    onClose();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = "";
    };
  });

  return (
    <div role="dialog" aria-modal="true" aria-label={`Notes: ${current.title}`} className="fixed inset-0 z-50 flex flex-col gap-3 overflow-auto bg-bg p-4">
      <nav aria-label="Notes navigation" className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2">
        <Button variant="quiet" onClick={leave}>
          <ArrowLeft size={16} aria-hidden /> Back to roadmap
        </Button>
        <Link href="/reading-room" onClick={(e) => dirty && !confirm("Leave without saving your changes to this note?") && e.preventDefault()} className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm hover:bg-surface">
          <Home size={16} aria-hidden /> Main menu
        </Link>
        <span className="ml-auto flex items-center gap-2">
          <Button variant="quiet" onClick={() => go(steps[i - 1])} disabled={i <= 0} aria-label="Previous step">
            <ChevronLeft size={16} aria-hidden /> Previous
          </Button>
          <span className="text-xs text-muted">{i >= 0 ? `${i + 1} of ${steps.length}` : ""}</span>
          <Button variant="quiet" onClick={() => go(steps[i + 1])} disabled={i < 0 || i >= steps.length - 1} aria-label="Next step">
            Next <ChevronRight size={16} aria-hidden />
          </Button>
        </span>
      </nav>
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <NotePane key={current.id} archiveId={archiveId} stepId={current.id} title={current.title} onClose={leave} fill onDirty={setDirty} />
      </div>
    </div>
  );
}
