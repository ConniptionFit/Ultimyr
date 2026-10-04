import type { McpConfig } from "./config.js";

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public code: string,
    public issues: string[] = [],
  ) {
    super(code);
  }
}

export type Service = "auth" | "content" | "quiz" | "notes";
export interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}
export type Upstream = (service: Service, path: string, bearer: string, opts?: CallOptions) => Promise<any>;

/** Call another Ultimyr service as the person, with their own token. This service holds no credentials of its own. */
export function createUpstream(cfg: Pick<McpConfig, "authUrl" | "contentUrl" | "quizUrl" | "notesUrl">, fetchImpl: typeof fetch = fetch): Upstream {
  const base = { auth: cfg.authUrl, content: cfg.contentUrl, quiz: cfg.quizUrl, notes: cfg.notesUrl };
  return async (service, path, bearer, opts = {}) => {
    const url = new URL(`${base[service]}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: opts.method ?? "GET",
        headers: { authorization: `Bearer ${bearer}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new UpstreamError(503, "service_unavailable");
    }
    if (res.status === 204) return null;
    const json = (await res.json().catch(() => null)) as { error?: string; issues?: unknown } | null;
    if (!res.ok) throw new UpstreamError(res.status, typeof json?.error === "string" ? json.error : "error", Array.isArray(json?.issues) ? json.issues.map(String).slice(0, 5) : []);
    return json;
  };
}
