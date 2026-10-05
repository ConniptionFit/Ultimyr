import { NAMESPACE_ALIASES, NAMESPACES, VOCABULARY, type KnownNamespace } from "./vocabulary.js";

export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}:[a-z0-9][a-z0-9-]{0,39}$/;
export const MAX_TAGS_PER_TARGET = 30;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

/** word (slug) -> topic or content type it points at, built once from the vocabulary synonyms. */
const wordIndex: Record<KnownNamespace, Map<string, string>> = { "content-type": new Map(), topic: new Map(), level: new Map() };
for (const ns of Object.keys(VOCABULARY) as KnownNamespace[]) {
  for (const [value, d] of Object.entries(VOCABULARY[ns])) {
    wordIndex[ns].set(value, value);
    for (const w of d.synonyms) if (!wordIndex[ns].has(slug(w))) wordIndex[ns].set(slug(w), value);
  }
}

export interface ParsedTag {
  namespace: string;
  value: string;
  tag: string;
}
export const isKnownNamespace = (ns: string): ns is KnownNamespace => Object.hasOwn(NAMESPACES, ns);

/**
 * Turn anything a person or assistant might type into one canonical tag, or null if nothing usable is left.
 * "AI" -> topic:ai, "Video" with the default namespace content-type -> content-type:video,
 * "type:Reading" -> content-type:reading, "artificial intelligence" -> topic:ai.
 */
export function normalizeTag(input: string, fallbackNamespace: string = "topic"): ParsedTag | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const colon = raw.indexOf(":");
  let ns = colon > 0 ? slug(raw.slice(0, colon)) : "";
  let value = slug(colon > 0 ? raw.slice(colon + 1) : raw);
  if (!value) return null;
  if (!ns) {
    // A bare word: use the fallback namespace, but let a content type word (video, quiz) win when it is clearly one.
    ns = slug(fallbackNamespace) || "topic";
    if (ns === "topic" && !wordIndex.topic.has(value) && wordIndex["content-type"].has(value)) ns = "content-type";
  }
  ns = NAMESPACE_ALIASES[ns] ?? ns;
  if (isKnownNamespace(ns)) value = wordIndex[ns].get(value) ?? value;
  const tag = `${ns}:${value}`;
  return TAG_PATTERN.test(tag) ? { namespace: ns, value, tag } : null;
}

/** Normalize a list: drops unusable entries, removes duplicates, keeps order. */
export function normalizeTags(list: readonly string[] | undefined | null, fallbackNamespace: string = "topic"): string[] {
  const out: string[] = [];
  for (const t of list ?? []) {
    const p = normalizeTag(t, fallbackNamespace);
    if (p && !out.includes(p.tag)) out.push(p.tag);
  }
  return out.slice(0, MAX_TAGS_PER_TARGET);
}

export const tagLabel = (tag: string): string => {
  const p = normalizeTag(tag);
  if (!p) return tag;
  const d = isKnownNamespace(p.namespace) ? VOCABULARY[p.namespace][p.value] : undefined;
  return d?.label ?? p.value.replaceAll("-", " ");
};
