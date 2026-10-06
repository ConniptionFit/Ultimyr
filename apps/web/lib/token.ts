/** When an access token stops working, in milliseconds since the epoch, read from its (unverified) payload. Null if it cannot be read. */
export function tokenExpiry(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** How long to wait before renewing a token: one minute before it expires, never sooner than 5 seconds. Unknown expiry assumes a 10 minute token. */
export function refreshDelay(expiry: number | null, now: number): number {
  const at = expiry ?? now + 10 * 60_000;
  return Math.max(5_000, at - now - 60_000);
}
