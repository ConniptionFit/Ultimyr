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
  const [reporting, setReporting] = useState(false);
  const [kind, setKind] = useState("wrong_answer");
  const [why, setWhy] = useState("");
  const [sent, setSent] = useState(false);

  async function report() {
    try {
      await api("POST", `questions/${questionId}/report`, { kind, message: why });
      setSent(true);
      setReporting(false);
      setWhy("");
    } catch {
      setMsg("Could not send the report. Try again.");
    }
  }

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
      {sent ? (
        <p role="status" className="text-sm text-muted">
          Thanks. The authors will see your report.
        </p>
      ) : reporting ? (
        <div className="space-y-2 rounded-md border border-line p-3 text-sm">
          <label className="block text-muted">
            What is wrong with it?
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
              <option value="wrong_answer">The marked answer looks wrong</option>
              <option value="unclear">It is unclear or ambiguous</option>
              <option value="typo">A typo or formatting problem</option>
              <option value="outdated">It is out of date</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label className="block text-muted">
            Details (optional)
            <textarea value={why} onChange={(e) => setWhy(e.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
          </label>
          <div className="flex gap-3">
            <button type="button" onClick={report} className="text-accent underline">
              Send report
            </button>
            <button type="button" onClick={() => setReporting(false)} className="text-muted underline">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setReporting(true)} className="text-sm text-muted underline">
          Report a problem with this question
        </button>
      )}
      {msg && (
        <p role="alert" className="text-sm text-danger">
          {msg}
        </p>
      )}
    </div>
  );
}
