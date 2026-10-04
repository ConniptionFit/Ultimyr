/** External links are stored and shown, never fetched, so a link can never make this server call another host. */

const TRACKING = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid|si|igshid)$/i;

/** True for an https URL with no embedded credentials. */
export function isSafeHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Lower-case the host, drop tracking parameters and a trailing slash, so the same page is not stored twice. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const out = u.toString();
  return u.pathname === "/" && !u.search && !u.hash ? out.replace(/\/$/, "") : out.replace(/\/(?=[?#]|$)/, "");
}

const PROVIDERS: Array<[RegExp, string]> = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "YouTube"],
  [/(^|\.)vimeo\.com$/, "Vimeo"],
  [/(^|\.)skilljar\.com$/, "Anthropic Academy"],
  [/(^|\.)(anthropic\.com|claude\.com|claude\.ai)$/, "Anthropic"],
  [/(^|\.)github\.com$/, "GitHub"],
  [/(^|\.)modelcontextprotocol\.io$/, "Model Context Protocol"],
  [/(^|\.)learn\.microsoft\.com$/, "Microsoft Learn"],
  [/(^|\.)coursera\.org$/, "Coursera"],
  [/(^|\.)udemy\.com$/, "Udemy"],
  [/(^|\.)comptia\.org$/, "CompTIA"],
];

/** A readable provider name from the host: known names first, otherwise the host without `www.`. */
export function providerFor(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  for (const [re, name] of PROVIDERS) if (re.test(host)) return name;
  return host.replace(/^www\./, "");
}

/** A sensible kind when the author does not give one. */
export function guessKind(url: string): "video" | "playlist" | "article" {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host)) return u.pathname.startsWith("/playlist") || u.searchParams.has("list") ? "playlist" : "video";
  if (/(^|\.)(youtu\.be|vimeo\.com)$/.test(host)) return "video";
  return "article";
}
