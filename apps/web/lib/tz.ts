/** Study and analytics reads that count "today", so they need the person's time zone. */
const NEEDS_ZONE = /^(study\/(queue|stats|activity)|analytics)(\?|$)/;

/** Adds `tz=<zone>` to the reads that count days. Anything else, and anything that already has a zone, is left alone. */
export function withZone(path: string, zone: string | null | undefined): string {
  if (!zone || !NEEDS_ZONE.test(path) || /[?&]tz=/.test(path)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}tz=${encodeURIComponent(zone)}`;
}

/** The browser's IANA time zone, or null when it cannot say. */
export function localZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
