import { isCloze } from "./cloze";

export type TypedResult = "match" | "close" | "different" | "empty";

/** Lowercase, drop Markdown marks and punctuation, collapse spaces, so "The  Answer!" and "the answer" compare equal. */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`#>~]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Edit distance between two short strings (insert, delete or swap one letter each cost 1). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** What a typed answer should be compared with: the hidden words of a cloze card, else the card's back. */
export function expectedAnswer(front: string, back: string): string {
  if (!isCloze(front)) return back;
  return [...front.matchAll(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g)].map((m) => m[1]).join(" ");
}

/** Compare what was typed with the expected answer. "close" allows about one slip in six letters, for typos. */
export function checkTyped(typed: string, expected: string): TypedResult {
  const a = normalizeAnswer(typed);
  const b = normalizeAnswer(expected);
  if (!a) return "empty";
  if (!b) return "different";
  if (a === b) return "match";
  return editDistance(a, b) <= Math.floor(b.length / 6) ? "close" : "different";
}
