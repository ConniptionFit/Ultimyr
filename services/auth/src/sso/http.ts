import { HttpError } from "../ctx.js";

/** Identity provider URLs are admin supplied, so they must be https (http only when explicitly allowed for dev). */
export function assertIdpUrl(raw: string, allowInsecure: boolean): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_url", { url: raw });
  }
  if (u.username || u.password) throw new HttpError(400, "invalid_url", { reason: "credentials in URL" });
  if (u.protocol !== "https:" && !(allowInsecure && u.protocol === "http:")) {
    throw new HttpError(400, "insecure_idp_url", { url: raw });
  }
  return u;
}

export async function fetchJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!res.ok) throw new Error(`IdP request failed: ${res.status}`);
  const text = await res.text();
  if (text.length > 1_000_000) throw new Error("IdP response too large");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Only same-site relative paths may be used as a post-login destination. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/reading-room";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return "/reading-room";
  return next;
}
