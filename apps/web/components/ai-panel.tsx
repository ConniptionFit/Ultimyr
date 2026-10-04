"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { aiMessage, PROVIDER_NAME, type AiCredential, type AiPrefs, type AiStatus, type Provider } from "@/lib/ai";

const fail = (e: unknown) => (e instanceof ApiError ? aiMessage(e.code) : "Could not reach the server.");

/** Settings: bring your own AI key. Keys are write-only: after saving, only the label and last four characters are ever shown. */
export function AiPanel() {
  const { api } = useAuth();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [creds, setCreds] = useState<AiCredential[]>([]);
  const [prefs, setPrefs] = useState<AiPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, c, p] = await Promise.all([api<AiStatus>("GET", "ai/status"), api<{ credentials: AiCredential[] }>("GET", "ai/credentials"), api<AiPrefs>("GET", "ai/preferences")]);
      setStatus(s);
      setCreds(c.credentials);
      setPrefs(p);
    } catch (e) {
      setError(fail(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    try {
      await api("POST", "ai/credentials", { provider: f.get("provider"), label: String(f.get("label")).trim(), secret: String(f.get("secret")).trim() });
      form.reset();
      setNote("Saved. The key is encrypted and cannot be shown again.");
      await load();
    } catch (err) {
      setError(fail(err));
    }
  }

  async function test(id: string) {
    setError(null);
    setNote("Testing…");
    try {
      const r = await api<{ ok: boolean; error?: string }>("POST", `ai/credentials/${id}/test`);
      setNote(r.ok ? "That key works." : null);
      if (!r.ok) setError(aiMessage(r.error ?? "provider_error"));
    } catch (err) {
      setNote(null);
      setError(fail(err));
    }
  }

  async function savePrefs(patch: Record<string, unknown>) {
    setError(null);
    try {
      await api("PUT", "ai/preferences", patch);
      await load();
    } catch (err) {
      setError(fail(err));
    }
  }

  return (
    <section className="space-y-4 border-t border-line pt-8" aria-label="AI connections">
      <div>
        <h2 className="text-xl">AI connections</h2>
        <p className="text-sm text-muted">
          Bring your own key for Gemini, OpenAI or Anthropic. Keys are encrypted for you alone, never shown again, and used only when you ask for AI help. Everything AI writes lands as a draft for you to review.
        </p>
      </div>
      {status && !status.vault && <p role="alert" className="text-sm text-danger">{aiMessage("vault_unavailable")}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {note && <p role="status" className="text-sm text-muted">{note}</p>}

      {creds.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {creds.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.label}</span>
                <span className="text-muted">
                  {PROVIDER_NAME[c.provider]} · ends in {c.last4}
                  {prefs?.defaultCredentialId === c.id ? " · default" : ""}
                </span>
              </span>
              <Button variant="quiet" onClick={() => test(c.id)}>Test</Button>
              {prefs?.defaultCredentialId !== c.id && <Button variant="quiet" onClick={() => savePrefs({ defaultCredentialId: c.id })}>Make default</Button>}
              <Button
                variant="quiet"
                className="text-danger"
                onClick={async () => {
                  if (!confirm("Delete this key? It is erased from the server.")) return;
                  await api("DELETE", `ai/credentials/${c.id}`).catch((e) => setError(fail(e)));
                  await load();
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="space-y-3 rounded-md border border-line p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="ai-provider" className="text-sm text-muted">Provider</label>
            <select id="ai-provider" name="provider" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
              {(Object.keys(PROVIDER_NAME) as Provider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_NAME[p]}</option>
              ))}
            </select>
          </div>
          <Field id="ai-label" name="label" label="Label" placeholder="Personal key" required maxLength={60} />
        </div>
        <Field id="ai-secret" name="secret" type="password" label="API key" autoComplete="off" required minLength={8} maxLength={512} />
        <Button type="submit" disabled={status ? !status.vault : false}>Save key</Button>
      </form>

      {prefs && status && creds.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted hover:text-ink">Models</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(Object.keys(PROVIDER_NAME) as Provider[]).map((p) => (
              <label key={p} className="space-y-1 text-muted">
                {PROVIDER_NAME[p]}
                <input
                  defaultValue={prefs.models[p] ?? ""}
                  placeholder={prefs.defaultModels[p]}
                  maxLength={80}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== (prefs.models[p] ?? "") && void savePrefs({ models: { [p]: e.target.value.trim() } })}
                  className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
                />
              </label>
            ))}
          </div>
        </details>
      )}

      {status && (
        <p className="text-xs text-muted">
          Today: {status.usage.requestsToday} of {status.usage.dailyLimit} AI requests, {status.usage.tokensToday.toLocaleString()} tokens.
        </p>
      )}
    </section>
  );
}
