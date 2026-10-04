export type Provider = "gemini" | "openai" | "anthropic";
export interface AiStatus {
  vault: boolean;
  providers: Provider[];
  defaultModels: Record<Provider, string>;
  usage: { requestsToday: number; tokensToday: number; dailyLimit: number };
}
export interface AiCredential { id: string; provider: Provider; label: string; last4: string; createdAt: string; lastUsedAt: string | null }
export interface AiPrefs { defaultCredentialId: string | null; models: Partial<Record<Provider, string>>; defaultModels: Record<Provider, string> }
export interface AiJob {
  id: string;
  kind: "guide" | "deck" | "quiz";
  status: "queued" | "running" | "succeeded" | "failed" | "interrupted";
  error: string | null;
  result: { itemId: string; counts: Record<string, number>; skipped?: number } | null;
}

export const PROVIDER_NAME: Record<Provider, string> = { gemini: "Google Gemini", openai: "OpenAI", anthropic: "Anthropic" };

/** Plain words for the safe error codes the gateway returns. */
export function aiMessage(code: string): string {
  const m: Record<string, string> = {
    vault_unavailable: "AI is not set up on this server yet. An admin needs to set the vault key.",
    no_credential: "Add an AI key in Settings first.",
    credential_rejected: "The provider rejected your key. Check it in Settings.",
    rate_limited: "The provider is rate limiting you. Try again in a minute.",
    provider_unavailable: "The provider is not answering right now.",
    quota_exceeded: "You have used today's AI allowance.",
    too_many_jobs: "Three generations are already running. Wait for one to finish.",
    model_output_invalid: "The model's answer could not be used. Try again, or give it more detail.",
    credential_unrecoverable: "That key can no longer be read. Delete it and add it again.",
  };
  return m[code] ?? code.replaceAll("_", " ");
}

/** Read a server-sent event stream from a POST (EventSource cannot send a body or a token). */
export async function streamSse(url: string, token: string, body: unknown, onEvent: (event: string, data: any) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const code = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "internal_error";
    throw Object.assign(new Error(code), { code });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (ev && data) onEvent(ev, JSON.parse(data));
    }
  }
}
