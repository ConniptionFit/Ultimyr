export interface ParsedCard {
  front: string;
  back: string;
}

/**
 * Flashcards in a note are one per line as `Question :: Answer` under the `## Flashcards` heading
 * (docs/notes.md). Anything outside that section, HTML comments and blank lines are ignored.
 */
export function parseFlashcards(markdown: string, max = 500): { cards: ParsedCard[]; skipped: number } {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/<!--[\s\S]*?-->/g, "");
  const cards: ParsedCard[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let inSection = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      inSection = h[1]!.trim().toLowerCase() === "flashcards" && line.startsWith("## ");
      continue;
    }
    if (!inSection || !line) continue;
    const m = /^(?:[-*]\s+)?(.+?)\s::\s(.+)$/.exec(line);
    const front = m?.[1]?.trim().slice(0, 5000);
    const back = m?.[2]?.trim().slice(0, 10_000);
    if (!front || !back) {
      skipped++;
      continue;
    }
    if (seen.has(front.toLowerCase())) continue;
    seen.add(front.toLowerCase());
    if (cards.length >= max) {
      skipped++;
      continue;
    }
    cards.push({ front, back });
  }
  return { cards, skipped };
}
