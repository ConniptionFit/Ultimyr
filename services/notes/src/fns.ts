/** Thin client for the Fast Note Sync REST API (`token` header). The server URL comes from operator config only. */
export class FnsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface FnsNote {
  path: string;
  content: string;
  hash: string;
}

export interface Fns {
  vaults(token: string): Promise<string[]>;
  getNote(token: string, vault: string, path: string): Promise<FnsNote | null>;
  /** createOnly fails when the note exists, so a scaffold can never overwrite writing. Returns the new hash. */
  createNote(token: string, vault: string, path: string, content: string): Promise<string>;
  /** Updates with a base hash so a concurrent edit in Obsidian is a conflict, not a silent overwrite. */
  saveNote(token: string, vault: string, path: string, content: string, baseHash: string): Promise<string>;
  patchFrontmatter(token: string, vault: string, path: string, updates: Record<string, unknown>): Promise<void>;
}

export function httpFns(baseUrl: string, timeoutMs = 8000): Fns {
  async function call(token: string, method: string, route: string, opts: { query?: Record<string, string>; body?: unknown } = {}) {
    const url = new URL(`${baseUrl}/api${route}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { token, ...(opts.body ? { "content-type": "application/json" } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new FnsError(503, "fns_unreachable");
    }
    if (res.status === 401 || res.status === 403) throw new FnsError(401, "fns_token_rejected");
    let json: { status?: boolean; message?: string; data?: any } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      /* not JSON */
    }
    if (!res.ok || json.status === false) throw new FnsError(res.status === 200 ? 409 : res.status, String(json.message ?? `fns_${res.status}`));
    return json.data;
  }

  return {
    async vaults(token) {
      const data = (await call(token, "GET", "/vault")) as { vault: string }[] | null;
      return (data ?? []).map((v) => v.vault);
    },
    async getNote(token, vault, path) {
      try {
        const d = await call(token, "GET", "/note", { query: { vault, path } });
        if (!d || typeof d.content !== "string") return null;
        return { path, content: d.content, hash: String(d.contentHash ?? "") };
      } catch (e) {
        if (e instanceof FnsError && e.status !== 503 && e.status !== 401) return null;
        throw e;
      }
    },
    async createNote(token, vault, path, content) {
      const d = await call(token, "POST", "/note", { body: { vault, path, content, createOnly: true } });
      return String(d?.contentHash ?? "");
    },
    async saveNote(token, vault, path, content, baseHash) {
      const d = await call(token, "POST", "/note", { body: { vault, path, content, baseHash } });
      return String(d?.contentHash ?? "");
    },
    async patchFrontmatter(token, vault, path, updates) {
      await call(token, "PATCH", "/note/frontmatter", { body: { vault, path, updates } });
    },
  };
}
