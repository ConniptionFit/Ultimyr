"use client";

import { ExternalLink, Layers, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { notesMessage, type StepNote } from "@/lib/notes";

/**
 * The right hand side of the side-by-side view: the step's Markdown note, from your Obsidian vault via Fast Note Sync.
 * Saving sends the hash we loaded, so an edit made in Obsidian meanwhile is a conflict rather than a silent overwrite.
 */
export function NotePane({ archiveId, stepId, title, onClose, fill = false, onDirty }: { archiveId: string; stepId: string; title: string; onClose: () => void; /** Fill the height of the page (full screen) instead of a fixed card. */ fill?: boolean; onDirty?: (dirty: boolean) => void }) {
  const { api } = useAuth();
  const [note, setNote] = useState<StepNote | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deck, setDeck] = useState<{ id: string; count: number } | null>(null);
  const [deckMsg, setDeckMsg] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== saved;
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  const load = useCallback(async () => {
    setError(null);
    setConflict(false);
    try {
      const n = await api<StepNote>("GET", `notes/steps/${stepId}`);
      setNote(n);
      setText(n.content);
      setSaved(n.content);
    } catch (e) {
      setError(e instanceof ApiError ? notesMessage(e.code) : "Could not load the note.");
    }
  }, [api, stepId]);
  useEffect(() => {
    setNote(null);
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!note || busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ hash: string }>("PUT", `notes/steps/${stepId}`, { content: text, baseHash: note.hash });
      setNote({ ...note, hash: r.hash });
      setSaved(text);
      setConflict(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === "conflict") setConflict(true);
      setError(e instanceof ApiError ? notesMessage(e.code) : "Could not save the note.");
    } finally {
      setBusy(false);
    }
  }, [api, busy, dirty, note, stepId, text]);

  /** Turns the saved `Question :: Answer` lines into a new deck in this archive. Reads the saved note, so save first. */
  async function makeDeck() {
    setDeckMsg(null);
    setDeck(null);
    try {
      const r = await api<{ cards: { front: string; back: string }[]; skipped: number }>("GET", `notes/steps/${stepId}/flashcards`);
      if (!r.cards.length) return setDeckMsg("No flashcards found. Add lines like Question :: Answer under the Flashcards heading, then save.");
      const made = await api<{ id: string }>("POST", `archives/${archiveId}/items`, { kind: "deck", title: `${title}: flashcards`, summary: "From my notes.", cards: r.cards, source: "human" });
      setDeck({ id: made.id, count: r.cards.length });
      if (r.skipped) setDeckMsg(`${r.skipped} line(s) were skipped (no Question :: Answer, or a duplicate).`);
    } catch (e) {
      setDeckMsg(e instanceof ApiError ? notesMessage(e.code) : "Could not make the deck.");
    }
  }

  return (
    <aside aria-label={`Notes for ${title}`} className={`flex flex-col gap-3 rounded-md border border-line p-3 ${fill ? "min-h-0 flex-1" : "min-h-[24rem]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{title}</p>
          {note && <p className="truncate text-xs text-muted">{note.path}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {note && (
            <a href={note.obsidianUrl} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">
              <ExternalLink size={14} aria-hidden /> Open in Obsidian
            </a>
          )}
          <button
            type="button"
            aria-label="Close notes"
            onClick={() => {
              if (!dirty || confirm("Close without saving your changes to this note?")) onClose();
            }}
            className="rounded-md p-1 text-muted hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}{" "}
          {conflict && (
            <button type="button" className="underline" onClick={() => confirm("Reload and lose your unsaved text? Copy it first if you want to keep it.") && void load()}>
              Reload
            </button>
          )}
        </p>
      )}
      {!note && !error && <p className="text-sm text-muted">Loading the note…</p>}
      {note && !note.exists && <p className="text-sm text-muted">This note is not in your vault any more. Creating notes again will restore it.</p>}
      {note && note.exists && (
        <>
          <div role="tablist" aria-label="Note view" className="flex gap-1 text-sm">
            {(["edit", "preview"] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1 ${mode === m ? "bg-surface text-ink" : "text-muted hover:text-ink"}`}>
                {m === "edit" ? "Edit" : "Preview"}
              </button>
            ))}
          </div>
          {mode === "edit" ? (
            <textarea
              ref={ref}
              aria-label="Note text (Markdown)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                  e.preventDefault();
                  void save();
                }
              }}
              spellCheck
              className={`w-full flex-1 resize-y rounded-md border border-line bg-surface p-3 font-mono text-sm text-ink ${fill ? "min-h-[50vh]" : "min-h-[18rem]"}`}
            />
          ) : (
            <div className={`prose-sm flex-1 overflow-auto rounded-md border border-line p-3 ${fill ? "min-h-[50vh]" : "min-h-[18rem]"}`}>
              <Markdown>{text.replace(/^---\n[\s\S]*?\n---\n/, "")}</Markdown>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={() => void save()} disabled={!dirty || busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="quiet" onClick={() => void makeDeck()} disabled={dirty} title={dirty ? "Save first: the deck is made from the saved note" : undefined}>
              <Layers size={16} aria-hidden /> Make a deck
            </Button>
            <span role="status" className="text-xs text-muted">
              {dirty ? "Unsaved changes" : "Saved"}
            </span>
          </div>
          {(deck || deckMsg) && (
            <p role="status" className="text-sm text-muted">
              {deck && (
                <>
                  Made a deck of {deck.count} cards.{" "}
                  <Link href={`/items/${deck.id}`} className="text-accent underline">
                    Open it
                  </Link>
                  .{" "}
                </>
              )}
              {deckMsg}
            </p>
          )}
        </>
      )}
    </aside>
  );
}
