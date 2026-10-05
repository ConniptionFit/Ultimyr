import catalogJson from "../data/catalog.json";
import { isKnownNamespace, normalizeTag, normalizeTags } from "./tags.js";
import { NAMESPACES, VOCABULARY } from "./vocabulary.js";

export const LUCIDE_VERSION: string = catalogJson.lucideVersion;
const lucide = catalogJson.icons as Record<string, string[]>;
export const ICON_NAMES: readonly string[] = Object.keys(lucide);
export const ICON_COUNT = ICON_NAMES.length;
export const DEFAULT_ICON = "book-open";
/** An automatic pick needs at least this much evidence: one curated match on a tag set directly, or several word matches. */
export const MIN_AUTO_SCORE = 5;

export const hasIcon = (name: unknown): name is string => typeof name === "string" && Object.hasOwn(lucide, name);

interface Entry {
  name: string;
  /** Lucide's own search tags for what the icon depicts. */
  tags: string[];
  words: Set<string>;
}
const entries = new Map<string, Entry>(
  ICON_NAMES.map((name) => {
    const tags = lucide[name]!;
    const words = new Set<string>([name, ...name.split("-"), ...tags, ...tags.flatMap((t) => t.split(/[\s-]+/))]);
    return [name, { name, tags, words }];
  }),
);

interface Rule {
  tag: string;
  weight: number;
  curated: Map<string, number>;
  words: string[];
}
const rules = new Map<string, Rule>();
function ruleFor(tag: string): Rule | null {
  const cached = rules.get(tag);
  if (cached) return cached;
  const p = normalizeTag(tag);
  if (!p || !isKnownNamespace(p.namespace)) return null;
  const d = VOCABULARY[p.namespace][p.value];
  const words = new Set<string>([p.value.replaceAll("-", " "), ...p.value.split("-"), ...(d?.synonyms ?? [])]);
  const rule: Rule = {
    tag: p.tag,
    weight: NAMESPACES[p.namespace].weight,
    curated: new Map((d?.icons ?? []).map((n, i) => [n, i])),
    words: [...words].filter((w) => w.length > 2 || /^[a-z]{2}$/.test(w)).map((w) => w.toLowerCase()),
  };
  if (p.namespace === "level") rule.words = [];
  rules.set(tag, rule);
  return rule;
}

/** Points one tag gives one icon: a curated pick is worth most (earlier in the list, more), a matching word a little. */
function pointsFor(rule: Rule, e: Entry): { points: number; why: "curated" | "words" | null } {
  const rank = rule.curated.get(e.name);
  if (rank !== undefined) return { points: 10 - Math.min(rank, 6) * 0.6, why: "curated" };
  let hits = 0;
  for (const w of rule.words) if (e.words.has(w) || e.words.has(w.replaceAll(" ", "-"))) hits++;
  return hits ? { points: 2.5 * Math.min(hits, 3), why: "words" } : { points: 0, why: null };
}

export type WeightedTags = ReadonlyArray<string | { tag: string; weight?: number }>;
export interface IconSuggestion {
  name: string;
  score: number;
  /** The requested tags that made this icon rank, most helpful first. */
  matched: string[];
}

/**
 * Rank every icon for a set of tags. The more of the requested tags an icon is suited to, the higher it sits, and a
 * curated pick beats a word match. Weight a tag below 1 to count it less (tags inherited from a parent do that).
 */
export function suggestIcons(tags: WeightedTags, opts: { limit?: number; exclude?: Iterable<string> } = {}): IconSuggestion[] {
  const want = new Map<string, number>();
  for (const t of tags) {
    const raw = typeof t === "string" ? t : t.tag;
    const p = normalizeTag(raw);
    if (!p) continue;
    const w = typeof t === "string" ? 1 : t.weight ?? 1;
    want.set(p.tag, Math.max(want.get(p.tag) ?? 0, w));
  }
  const ruleList = [...want].map(([tag, w]) => ({ rule: ruleFor(tag), w })).filter((x): x is { rule: Rule; w: number } => !!x.rule);
  if (!ruleList.length) return [];
  const skip = new Set(opts.exclude ?? []);
  const out: IconSuggestion[] = [];
  for (const e of entries.values()) {
    if (skip.has(e.name)) continue;
    let score = 0;
    const matched: Array<[string, number]> = [];
    for (const { rule, w } of ruleList) {
      const { points } = pointsFor(rule, e);
      if (!points) continue;
      const v = points * w * rule.weight;
      score += v;
      matched.push([rule.tag, v]);
    }
    if (score > 0) out.push({ name: e.name, score: Math.round(score * 100) / 100, matched: matched.sort((a, b) => b[1] - a[1]).map(([t]) => t) });
  }
  out.sort((a, b) => b.score - a.score || b.matched.length - a.matched.length || a.name.localeCompare(b.name));
  return out.slice(0, Math.max(1, opts.limit ?? 8));
}

/** The icon to assign automatically, or null when nothing is a confident match. */
export function bestIcon(tags: WeightedTags): IconSuggestion | null {
  const top = suggestIcons(tags, { limit: 1 })[0];
  return top && top.score >= MIN_AUTO_SCORE ? top : null;
}

export interface IconInfo {
  name: string;
  /** What the icon depicts, in Lucide's own words. */
  tags: string[];
  /** The vocabulary tags this icon suits, best first. Where it will be suggested. */
  suggestFor: Array<{ tag: string; score: number }>;
}
let suggestIndex: Map<string, Array<{ tag: string; score: number }>> | null = null;
function suitability(): Map<string, Array<{ tag: string; score: number }>> {
  if (suggestIndex) return suggestIndex;
  const idx = new Map<string, Array<{ tag: string; score: number }>>();
  for (const ns of Object.keys(VOCABULARY) as Array<keyof typeof VOCABULARY>) {
    for (const value of Object.keys(VOCABULARY[ns])) {
      const rule = ruleFor(`${ns}:${value}`);
      if (!rule) continue;
      for (const e of entries.values()) {
        const { points } = pointsFor(rule, e);
        if (points >= MIN_AUTO_SCORE / 2) (idx.get(e.name) ?? idx.set(e.name, []).get(e.name)!).push({ tag: rule.tag, score: points });
      }
    }
  }
  for (const list of idx.values()) list.sort((a, b) => b.score - a.score);
  return (suggestIndex = idx);
}

export function iconInfo(name: string): IconInfo | null {
  const e = entries.get(name);
  return e ? { name, tags: e.tags, suggestFor: suitability().get(name) ?? [] } : null;
}

/** Find icons by name or by any of Lucide's tags. Exact name first, then names that start with it, then the rest. */
export function searchIcons(query: string, opts: { limit?: number; offset?: number; tag?: string } = {}): { total: number; icons: IconInfo[] } {
  const q = query.trim().toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 48, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  let names: string[];
  if (opts.tag) {
    names = suggestIcons([opts.tag], { limit: ICON_COUNT }).map((s) => s.name);
    if (q) names = names.filter((n) => entries.get(n)!.words.has(q) || n.includes(q));
  } else if (!q) names = [...ICON_NAMES];
  else {
    const rank = (e: Entry) => (e.name === q ? 0 : e.name.startsWith(q) ? 1 : e.name.split("-").includes(q) ? 2 : e.tags.includes(q) ? 3 : e.name.includes(q) ? 4 : e.tags.some((t) => t.includes(q)) ? 5 : 9);
    names = [...entries.values()]
      .map((e) => ({ e, r: rank(e) }))
      .filter((x) => x.r < 9)
      .sort((a, b) => a.r - b.r || a.e.name.localeCompare(b.e.name))
      .map((x) => x.e.name);
  }
  return { total: names.length, icons: names.slice(offset, offset + limit).map((n) => iconInfo(n)!) };
}

/** Normalize a list of tags for use with suggestions (kept here so callers need one import). */
export const tagsFor = normalizeTags;
