"use client";

import { Bookmark } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/lib/auth";

/** A bookmark and a private note on one question. Both follow you into later attempts and drills; nobody else sees them. */
export function QuestionMarks({ questionId, bookmarked, note, onSaved }: { questionId: string; bookmarked: boolean; note: string; onSaved: (m: { bookmarked: boolean; note: string }) => void }) {
  const { api } = useAuth();
  const [text, setText] = useState(note);
  const [pinned, setPinned] = useState(bookmarked);
  const [msg, setMsg] = useState("");

  async function save(body: { bookmarked?: boolean; note?: string }) {
    try {
      const r = await api<{ bookmarked: boolean; note: string }>("PUT", `questions/${questionId}/mark`, body);
      setMsg("");
      onSaved({ bookmarked: r.bookmarked, note: r.note });
    } catch {
      setMsg("Could not save. Try again.");
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4">
      <button
        type="button"
        aria-pressed={pinned}
        onClick={() => {
          setPinned(!pinned);
          void save({ bookmarked: !pinned });
        }}
        className="flex items-center gap-2 text-sm text-accent underline"
      >
        <Bookmark size={14} aria-hidden fill={pinned ? "currentColor" : "none"} /> {pinned ? "Bookmarked (drill your bookmarks from Drills)" : "Bookmark this question"}
      </button>
      <label className="block text-sm text-muted">
        My note (private)
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== note && void save({ note: text })}
          maxLength={2000}
          rows={2}
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
          placeholder="A mnemonic, why you got it wrong, what to look up"
        />
      </label>
      {msg && (
        <p role="alert" className="text-sm text-danger">
          {msg}
        </p>
      )}
    </div>
  );
}
