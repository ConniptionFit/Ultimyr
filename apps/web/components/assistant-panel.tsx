"use client";

import { MessageCircle } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { aiMessage, streamSse } from "@/lib/ai";

interface Msg { role: "user" | "assistant"; text: string }

/** A study assistant tied to what the learner is looking at (a guide, a deck, or an attempt's results). Answers stream in. */
export function AssistantPanel({ context, label = "Ask the assistant" }: { context: { type: "item" | "attempt"; id: string }; label?: string }) {
  const { state, api } = useAuth();
  const { copy } = useNaming();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thread = useRef<string | null>(null);

  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const content = String(new FormData(form).get("q")).trim();
    if (!content || state.status !== "authenticated" || busy) return;
    form.reset();
    setError(null);
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: content }, { role: "assistant", text: "" }]);
    const append = (t: string) => setMsgs((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, text: x.text + t } : x)));
    try {
      thread.current ??= (await api<{ id: string }>("POST", "ai/agent/threads", { context })).id;
      await streamSse(`/api/v1/ai/agent/threads/${thread.current}/messages`, state.accessToken, { content }, (ev, d) => {
        if (ev === "delta") append(d.text);
        if (ev === "error") setError(aiMessage(d.code));
      });
    } catch (err) {
      setError(aiMessage((err as { code?: string }).code ?? "provider_unavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button variant="quiet" onClick={() => setOpen(!open)} aria-expanded={open}>
        <MessageCircle size={16} aria-hidden /> {label}
      </Button>
      {open && (
        <section aria-label="Assistant" className="mt-3 space-y-3 rounded-md border border-line p-4">
          <div className="max-h-96 space-y-3 overflow-y-auto text-sm" aria-live="polite">
            {msgs.length === 0 && <p className="text-muted">Ask about anything here. The assistant can see this page and nothing else of yours.</p>}
            {msgs.map((m, i) => (
              <p key={i} className={`whitespace-pre-wrap ${m.role === "user" ? "text-muted" : ""}`}>
                <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
                {m.text || copy("aiThinking")}
              </p>
            ))}
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <form onSubmit={send} className="flex gap-2">
            <input name="q" required maxLength={4000} aria-label="Your question" className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-ink" />
            <Button type="submit" disabled={busy}>Ask</Button>
          </form>
          <p className="text-xs text-muted">AI can be wrong. Check anything that matters against the official source.</p>
        </section>
      )}
    </div>
  );
}
