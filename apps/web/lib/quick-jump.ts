export interface JumpEntry {
  id: string;
  label: string;
  /** Small grey text after the label, such as "Exam prep" or a vendor. */
  hint?: string;
  href: string;
  /** Extra words that should match but are not shown. */
  keywords?: string;
}

/** 0 = no match. Higher is better: label prefix, then a word prefix, then a substring, then letters in order. */
export function jumpScore(entry: JumpEntry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = entry.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.split(/[\s\-/:]+/).some((w) => w.startsWith(q))) return 60;
  if (label.includes(q)) return 40;
  const extra = `${entry.hint ?? ""} ${entry.keywords ?? ""}`.toLowerCase();
  if (extra.includes(q)) return 25;
  let at = 0;
  for (const ch of q) {
    at = label.indexOf(ch, at);
    if (at === -1) return 0;
    at += 1;
  }
  return 10;
}

/** Entries that match, best first. Ties keep their given order, so callers control what leads an empty query. */
export function rankJump(entries: JumpEntry[], query: string, limit = 8): JumpEntry[] {
  return entries
    .map((e, i) => ({ e, i, s: jumpScore(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}
