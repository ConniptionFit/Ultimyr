"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { aiMessage, type AiJob } from "@/lib/ai";

/** Archive page: ask AI for a draft guide, deck or quiz. The draft opens for review and is never published automatically. */
export function GeneratePanel({ archiveId, onDone }: { archiveId: string; onDone: () => void }) {
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [job, setJob] = useState<AiJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function poll(id: string) {
    try {
      const j = await api<AiJob>("GET", `ai/jobs/${id}`);
      setJob(j);
      if (j.status === "queued" || j.status === "running") timer.current = setTimeout(() => void poll(id), 1500);
      else if (j.status === "succeeded") onDone();
    } catch (e) {
      setError(e instanceof ApiError ? aiMessage(e.code) : "Lost contact with the server.");
    }
  }

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setJob(null);
    const count = Number(f.get("count"));
    try {
      const { jobId } = await api<{ jobId: string }>("POST", "ai/generate", {
        kind: f.get("kind"),
        archiveId,
        topic: String(f.get("topic")).trim(),
        ...(String(f.get("source")).trim() ? { source: String(f.get("source")) } : {}),
        ...(count ? { count } : {}),
      });
      setJob({ id: jobId, kind: f.get("kind") as AiJob["kind"], status: "queued", error: null, result: null });
      void poll(jobId);
    } catch (err) {
      setError(err instanceof ApiError ? aiMessage(err.code) : "Could not reach the server.");
    }
  }

  const busy = job?.status === "queued" || job?.status === "running";
  return (
    <div>
      <Button variant="quiet" onClick={() => setOpen(!open)}>
        <Sparkles size={16} aria-hidden /> Generate with AI
      </Button>
      {open && (
        <form onSubmit={start} className="mt-3 space-y-3 rounded-md border border-line p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor="g-kind" className="text-sm text-muted">What to write</label>
              <select id="g-kind" name="kind" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                <option value="guide">Study guide</option>
                <option value="deck">Flashcards</option>
                <option value="quiz">Quiz questions</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor="g-topic" className="text-sm text-muted">Topic</label>
              <input id="g-topic" name="topic" required maxLength={300} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="g-source" className="text-sm text-muted">Source material (optional). Paste notes or an exam guide, and the AI sticks to it.</label>
            <textarea id="g-source" name="source" rows={5} maxLength={40000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
          </div>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="g-count" className="text-sm text-muted">How many (cards or questions)</label>
              <input id="g-count" name="count" type="number" min={1} max={50} className="w-32 rounded-md border border-line bg-surface px-3 py-2 text-ink" />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Writing…" : "Generate"}</Button>
          </div>
          <p className="text-xs text-muted">Uses your own AI key from Settings. The result is a draft that only editors can see until you publish it.</p>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {job && (
        <p role="status" className="mt-2 text-sm">
          {busy && "The AI is writing a draft…"}
          {job.status === "succeeded" && job.result && (
            <>
              Draft ready{job.result.skipped ? ` (${job.result.skipped} unusable items were left out)` : ""}.{" "}
              <Link href={`/items/${job.result.itemId}`} className="text-accent underline">Review it</Link>
            </>
          )}
          {job.status === "failed" && <span className="text-danger">{aiMessage(job.error ?? "failed")}</span>}
          {job.status === "interrupted" && <span className="text-danger">The server restarted while writing. Try again.</span>}
        </p>
      )}
    </div>
  );
}
