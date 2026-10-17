export interface GlossaryTerm {
  id: string;
  term: string;
  expansion: string;
  definition: string;
  status: "draft" | "published";
}
export interface ParsedTerm {
  term: string;
  expansion: string;
  definition: string;
}

/**
 * Read pasted glossary lines. Accepted shapes, one per line (blank lines and `#` headings are skipped):
 *   `AES (Advanced Encryption Standard): a symmetric block cipher`
 *   `AES - a symmetric block cipher`  (also an en dash, a colon or a tab)
 * Returns the terms and the lines that could not be read.
 */
export function parseGlossary(text: string): { terms: ParsedTerm[]; skipped: string[] } {
  const terms: ParsedTerm[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s+/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(.{1,100}?)(?:\s*\(([^)]{1,200})\))?\s*(?::|\t|\s[-–]\s)\s*(.+)$/.exec(line);
    if (!m || !m[1] || !m[3]) {
      skipped.push(line);
      continue;
    }
    terms.push({ term: m[1].trim(), expansion: (m[2] ?? "").trim(), definition: m[3].trim() });
  }
  return { terms, skipped };
}

/** One flashcard per term for a deck: the term (with its expansion) on the front, the definition on the back. */
export const glossaryCards = (terms: Pick<GlossaryTerm, "term" | "expansion" | "definition">[]) =>
  terms.map((t) => ({ front: t.expansion ? `${t.term} (${t.expansion})` : t.term, back: t.definition }));
