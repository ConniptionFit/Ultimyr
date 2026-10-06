export interface NoteText {
  stepId: string;
  content: string;
}
export interface NoteHit {
  stepId: string;
  snippet: string;
}

/** Notes that contain every word of the query (case blind), each with a short snippet around the first word. */
export function searchNotes(notes: NoteText[], query: string, max = 20): NoteHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits: NoteHit[] = [];
  for (const n of notes) {
    const lower = n.content.toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    const at = lower.indexOf(words[0]!);
    const from = Math.max(0, at - 40);
    const raw = n.content.slice(from, at + 100).replace(/\s+/g, " ").trim();
    hits.push({ stepId: n.stepId, snippet: `${from > 0 ? "…" : ""}${raw}${at + 100 < n.content.length ? "…" : ""}` });
    if (hits.length >= max) break;
  }
  return hits;
}
