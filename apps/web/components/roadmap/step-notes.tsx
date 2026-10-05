"use client";

import { ExternalLink, Layers, NotebookPen } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { NoteToolbar, noteKeyDown } from "./note-toolbar";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { notesMessage, type MirrorState, type StepNote } from "@/lib/notes";

const TEMPLATE = "## Summary\n\n## Key points\n- \n\n## Examples\n\n## Questions\n- \n\n## Flashcards\n<!-- One per line: Question :: Answer -->\n";

const MIRROR_TEXT: Record<MirrorState, string> = {
  off: "",
  synced: " · in step with Obsidian",
  pending: " · Obsidian will catch up",
  unreachable: " · Obsidian is not reachable, will sync later",
  conflict: " · changed in Obsidian too",
};

/**
 * Your note for one step, directly under the step (and its video). It is kept in Ultimyr; if you connect Obsidian it is
 * mirrored both ways and this looks exactly the same. Saves by itself a moment after you stop typing.
 */
export function StepNotes({ archiveId, stepId, title, hasNote, obsidian, onChange }: { archiveId: string; stepId: string; title: string; hasNote: boolean; obsidian: boolean; onChange: (has: boolean) => void }) {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<StepNote | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mirror, setMirror] = useState<MirrorState>("off");
  const [remote, setRemote] = useState<string | null>(null);
  const [deck, setDeck] = useState<{ id: string; count: number } | null>(null);
  const [deckMsg, setDeckMsg] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ text, saved, note, busy });
  latest.current = { text, saved, note, busy };
  const dirty = text !== saved;

  const apply = useCallback(
    (n: StepNote, adopt: boolean) => {
      setNote(n);
      setMirror(n.mirror);
      setRemote(n.mirror === "conflict" ? (n.remote ?? "") : null);
      if (adopt) {
        setText(n.content);
        setSaved(n.content);
      }
      onChange(n.content.trim().length > 0);
    },
    [onChange],
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      apply(await api<StepNote>("GET", `notes/steps/${stepId}?archive=${archiveId}`), true);
    } catch (e) {
      setError(e instanceof ApiError ? notesMessage(e.code) : "Could not load your note.");
    }
  }, [api, apply, archiveId, stepId]);

  useEffect(() => {
    if (open && !note && !error) void load();
  }, [open, note, error, load]);

  const save = useCallback(async () => {
    const cur = latest.current;
    if (!cur.note || cur.busy || cur.text === cur.saved) return;
    const sending = cur.text;
    setBusy(true);
    setError(null);
    try {
      const n = await api<StepNote>("PUT", `notes/steps/${stepId}`, { archive: archiveId, content: sending, baseHash: cur.note.hash });
      setSaved(sending);
      apply({ ...n, content: sending }, false);
    } catch (e) {
      setError(e instanceof ApiError ? (e.code === "conflict" ? "This note changed somewhere else. Reload it before saving." : notesMessage(e.code)) : "Could not save your note.");
    } finally {
      setBusy(false);
    }
  }, [api, apply, archiveId, stepId]);

  // Save a moment after typing stops.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void save(), 1200);
    return () => clearTimeout(t);
  }, [text, dirty, save]);

  async function resolve(keep: "mine" | "obsidian") {
    setError(null);
    try {
      apply(await api<StepNote>("POST", `notes/steps/${stepId}/resolve`, { archive: archiveId, keep }), true);
    } catch (e) {
      setError(e instanceof ApiError ? notesMessage(e.code) : "Could not resolve that.");
    }
  }

  /** Turns the saved `Question :: Answer` lines into a new deck in this archive. */
  async function makeDeck() {
    setDeckMsg(null);
    setDeck(null);
    try {
      const r = await api<{ cards: { front: string; back: string }[]; skipped: number }>("GET", `notes/steps/${stepId}/flashcards`);
      if (!r.cards.length) return setDeckMsg("No flashcards found. Add lines like Question :: Answer under a Flashcards heading.");
      const made = await api<{ id: string }>("POST", `archives/${archiveId}/items`, { kind: "deck", title: `${title}: flashcards`, summary: "From my notes.", cards: r.cards, source: "human" });
      setDeck({ id: made.id, count: r.cards.length });
      if (r.skipped) setDeckMsg(`${r.skipped} line(s) were skipped (no Question :: Answer, or a duplicate).`);
    } catch (e) {
      setDeckMsg(e instanceof ApiError ? notesMessage(e.code) : "Could not make the deck.");
    }
  }

  const panel = `notes-${stepId}`;
  return (
    <div className="basis-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => {
          if (open && dirty) void save();
          setOpen(!open);
        }}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:text-ink"
      >
        <NotebookPen size={16} aria-hidden />
        {hasNote ? "My notes" : "Add a note"}
        {hasNote && !open && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
        {hasNote && !open && <span className="sr-only">(you have a note here)</span>}
      </button>
      {open && (
        <section id={panel} aria-label={`Notes for ${title}`} className="mt-2 space-y-3 rounded-md border border-line p-3">
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}{" "}
              <button type="button" className="underline" onClick={() => void load()}>
                Reload
              </button>
            </p>
          )}
          {!note && !error && <p className="text-sm text-muted">Loading your note…</p>}
          {note && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div role="tablist" aria-label="Note view" className="flex gap-1 text-sm">
                  {(["write", "preview"] as const).map((m) => (
                    <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1 ${mode === m ? "bg-surface text-ink" : "text-muted hover:text-ink"}`}>
                      {m === "write" ? "Write" : "Preview"}
                    </button>
                  ))}
                </div>
                {obsidian && note.obsidianUrl && (
                  <a href={note.obsidianUrl} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">
                    <ExternalLink size={14} aria-hidden /> Open in Obsidian
                  </a>
                )}
              </div>
              {remote !== null && (
                <div role="alert" className="space-y-2 rounded-md border border-line bg-surface p-3 text-sm">
                  <p>This note was also changed in Obsidian. Nothing has been overwritten. Which version do you want to keep?</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-line p-2 text-xs text-muted">{remote || "(empty)"}</pre>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void resolve("mine")}>Keep mine</Button>
                    <Button variant="quiet" onClick={() => void resolve("obsidian")}>
                      Use the Obsidian version
                    </Button>
                  </div>
                </div>
              )}
              {mode === "write" ? (
                <>
                  <NoteToolbar target={box} controls={`${panel}-text`} setText={setText} />
                  <textarea
                    ref={box}
                    id={`${panel}-text`}
                    onKeyDown={(e) => noteKeyDown(e, setText)}
                    aria-label={`Note text for ${title} (Markdown)`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onBlur={() => void save()}
                    placeholder="Write what you want to remember. Use the buttons above, or type Markdown."
                    spellCheck
                    rows={Math.min(18, Math.max(6, text.split("\n").length + 1))}
                    className="w-full resize-y rounded-md border border-line bg-surface p-3 text-base text-ink sm:text-sm"
                  />
                  {!text.trim() && (
                    <button type="button" className="text-sm text-accent underline" onClick={() => setText(TEMPLATE)}>
                      Start from the note template
                    </button>
                  )}
                </>
              ) : (
                <div className="prose-sm min-h-24 overflow-auto rounded-md border border-line p-3">{text.trim() ? <Markdown>{text}</Markdown> : <p className="text-sm text-muted">Nothing here yet.</p>}</div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="quiet" onClick={() => void makeDeck()} disabled={dirty || busy} title={dirty ? "Wait for the note to save: the deck is made from the saved note" : undefined}>
                  <Layers size={16} aria-hidden /> Make a deck
                </Button>
                <span role="status" className="text-xs text-muted">
                  {busy ? "Saving…" : dirty ? "Unsaved changes" : `Saved${obsidian ? MIRROR_TEXT[mirror] : ""}`}
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
        </section>
      )}
    </div>
  );
}
