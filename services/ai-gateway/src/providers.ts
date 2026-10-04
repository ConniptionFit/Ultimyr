export type Provider = "gemini" | "openai" | "anthropic";
export const PROVIDERS: Provider[] = ["gemini", "openai", "anthropic"];

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface CompletionRequest {
  apiKey: string;
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
  /** Ask the model for a single JSON object (the generation jobs parse and validate it). */
  json?: boolean;
  signal?: AbortSignal;
}
export interface Usage {
  tokensIn: number;
  tokensOut: number;
}
export type Chunk = { delta: string } | { usage: Partial<Usage> };

/** A provider failure with a code that is safe to show. It never carries response bodies, which can echo request details. */
export class ProviderError extends Error {
  constructor(
    public status: number,
    public code: "credential_rejected" | "rate_limited" | "provider_unavailable" | "provider_error" | "bad_response",
  ) {
    super(code);
  }
}

export const DEFAULT_BASE_URLS: Record<Provider, string> = {
  gemini: "https://generativelanguage.googleapis.com",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
};

export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

/** Incremental parser for server-sent events. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let cut: number;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        yield { event: /^event:\s*(.+)$/m.exec(block)?.[1], data };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function fail(status: number): never {
  if (status === 401 || status === 403) throw new ProviderError(status, "credential_rejected");
  if (status === 429) throw new ProviderError(status, "rate_limited");
  if (status >= 500) throw new ProviderError(status, "provider_unavailable");
  throw new ProviderError(status, "provider_error");
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const obj = (s: string): Record<string, any> => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    throw new ProviderError(502, "bad_response");
  }
};

export interface Adapter {
  stream(req: CompletionRequest, baseUrl: string, fetchImpl?: typeof fetch): AsyncGenerator<Chunk>;
}

async function open(url: string, init: RequestInit, req: CompletionRequest, fetchImpl: typeof fetch) {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: req.signal ?? AbortSignal.timeout(120_000) });
  } catch {
    throw new ProviderError(503, "provider_unavailable");
  }
  if (!res.ok || !res.body) fail(res.status);
  return res.body;
}

const openai: Adapter = {
  async *stream(req, baseUrl, fetchImpl = fetch) {
    const body = await open(
      `${baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${req.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          messages: [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages],
          stream: true,
          stream_options: { include_usage: true },
          max_completion_tokens: req.maxTokens,
          ...(req.json ? { response_format: { type: "json_object" } } : {}),
        }),
      },
      req,
      fetchImpl,
    );
    for await (const ev of sseEvents(body)) {
      if (ev.data === "[DONE]") break;
      const j = obj(ev.data);
      const text = j.choices?.[0]?.delta?.content;
      if (typeof text === "string" && text) yield { delta: text };
      if (j.usage) yield { usage: { tokensIn: num(j.usage.prompt_tokens), tokensOut: num(j.usage.completion_tokens) } };
    }
  },
};

const anthropic: Adapter = {
  async *stream(req, baseUrl, fetchImpl = fetch) {
    const body = await open(
      `${baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": req.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages, stream: true }),
      },
      req,
      fetchImpl,
    );
    for await (const ev of sseEvents(body)) {
      const j = obj(ev.data);
      if (j.type === "content_block_delta" && typeof j.delta?.text === "string") yield { delta: j.delta.text };
      else if (j.type === "message_start") yield { usage: { tokensIn: num(j.message?.usage?.input_tokens) } };
      else if (j.type === "message_delta") yield { usage: { tokensOut: num(j.usage?.output_tokens) } };
      else if (j.type === "error") throw new ProviderError(502, "provider_error");
    }
  },
};

const gemini: Adapter = {
  async *stream(req, baseUrl, fetchImpl = fetch) {
    if (!MODEL_NAME.test(req.model)) throw new ProviderError(400, "provider_error");
    const body = await open(
      `${baseUrl}/v1beta/models/${req.model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        // The key goes in a header, never the URL, so it cannot end up in access logs.
        headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
        body: JSON.stringify({
          ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
          contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: req.maxTokens, ...(req.json ? { responseMimeType: "application/json" } : {}) },
        }),
      },
      req,
      fetchImpl,
    );
    for await (const ev of sseEvents(body)) {
      const j = obj(ev.data);
      for (const p of j.candidates?.[0]?.content?.parts ?? []) if (typeof p.text === "string" && p.text) yield { delta: p.text };
      if (j.usageMetadata) yield { usage: { tokensIn: num(j.usageMetadata.promptTokenCount), tokensOut: num(j.usageMetadata.candidatesTokenCount) } };
    }
  },
};

export const ADAPTERS: Record<Provider, Adapter> = { openai, anthropic, gemini };

/** Stream a completion. Usage chunks are folded into the returned totals by `complete`. */
export async function complete(provider: Provider, req: CompletionRequest, baseUrls: Record<Provider, string>, fetchImpl?: typeof fetch): Promise<{ text: string } & Usage> {
  let text = "";
  const usage: Usage = { tokensIn: 0, tokensOut: 0 };
  for await (const c of ADAPTERS[provider].stream(req, baseUrls[provider], fetchImpl)) {
    if ("delta" in c) text += c.delta;
    else {
      usage.tokensIn = c.usage.tokensIn ?? usage.tokensIn;
      usage.tokensOut = c.usage.tokensOut ?? usage.tokensOut;
    }
  }
  return { text, ...usage };
}
