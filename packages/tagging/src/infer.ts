import { normalizeTags } from "./tags.js";
import { ITEM_KIND_TYPES, RESOURCE_KIND_TYPES, TOPICS } from "./vocabulary.js";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const patterns = Object.entries(TOPICS).map(([value, d]) => ({
  value,
  res: [...new Set([value.replaceAll("-", " "), ...d.synonyms])].map((w) => new RegExp(`(?<![a-z0-9])${escape(w.toLowerCase())}(?:s|es)?(?![a-z0-9])`)),
}));

export interface InferredTag {
  tag: string;
  /** How many different vocabulary words matched. More is stronger. */
  hits: number;
}

/**
 * Read topic tags out of free text (a title, a summary, an objective). Nothing is stored from this: callers show it as
 * "inferred" and give it less weight than a tag a person set.
 */
export function inferTopics(text: string, max = 4): InferredTag[] {
  const t = text.toLowerCase();
  const found: InferredTag[] = [];
  for (const p of patterns) {
    const hits = p.res.filter((re) => re.test(t)).length;
    if (hits) found.push({ tag: `topic:${p.value}`, hits });
  }
  return found.sort((a, b) => b.hits - a.hits || a.tag.localeCompare(b.tag)).slice(0, max);
}

/** Content type tags implied by what the app already knows about a thing (resource kind or guide, deck, quiz). */
export function contentTypesFor(input: { resourceKind?: string | null; itemKind?: string | null }): string[] {
  const types = [...(input.resourceKind ? RESOURCE_KIND_TYPES[input.resourceKind] ?? [] : []), ...(input.itemKind ? ITEM_KIND_TYPES[input.itemKind] ?? [] : [])];
  return normalizeTags(types.map((t) => `content-type:${t}`));
}
