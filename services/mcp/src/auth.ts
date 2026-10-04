import { verifyAccessToken, type KeySource, type Principal } from "@ultimyr/authz";
import { createHash } from "node:crypto";
import type { McpConfig } from "./config.js";

export interface Authed {
  /** The access token, passed on to the other services unchanged. */
  token: string;
  principal: Principal;
}

const KEY_CACHE_MS = 2 * 60_000;
const KEY_CACHE_MAX = 1000;

/**
 * Accepts either an OAuth access token (verified against auth's public keys) or an API key (`ulk_...`),
 * which is exchanged at the auth service for a short, scope limited token. Exchanges are cached briefly,
 * so a revoked key stops working within two minutes.
 */
export class Authenticator {
  private cache = new Map<string, { authed: Authed; until: number }>();
  constructor(
    private keySource: KeySource,
    private cfg: Pick<McpConfig, "authUrl">,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  /** Returns null for anything that is not a valid credential. */
  async authenticate(header: string | undefined): Promise<Authed | null> {
    const raw = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!raw) return null;
    try {
      if (!raw.startsWith("ulk_")) return { token: raw, principal: await verifyAccessToken(raw, this.keySource) };
      const id = createHash("sha256").update(raw).digest("hex");
      const hit = this.cache.get(id);
      if (hit && hit.until > this.now()) return hit.authed;
      const res = await this.fetchImpl(`${this.cfg.authUrl}/v1/auth/token`, { method: "POST", headers: { authorization: `Bearer ${raw}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.cache.delete(id);
        return null;
      }
      const { accessToken, expiresIn } = (await res.json()) as { accessToken: string; expiresIn: number };
      const authed = { token: accessToken, principal: await verifyAccessToken(accessToken, this.keySource) };
      if (this.cache.size >= KEY_CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(id, { authed, until: this.now() + Math.min(KEY_CACHE_MS, (expiresIn - 60) * 1000) });
      return authed;
    } catch {
      return null;
    }
  }
}
