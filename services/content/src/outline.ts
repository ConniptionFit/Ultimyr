import { isSafeHttpsUrl, normalizeUrl } from "./links.js";

/**
 * A plain text outline becomes a roadmap, so a whole course (or a whole certification) can be pasted in one go.
 *
 *   ## Week 1: Foundations                      a stage
 *   - [Prep hub](https://example.com/hub) 90m   a link step, 90 minutes
 *     - [Lesson 1](https://youtu.be/abc) 12m    a step inside it (up to three levels)
 *   - [[Intro guide]]                           one of this archive's own guides, decks or quizzes, by title
 *   - Take a practice exam (optional) -- aim for 70%    a checkpoint, optional, with a note
 */
export interface OutlineStep {
  /** A link, a checkpoint text or the title of an item in the archive. */
  link?: { url: string; title: string };
  itemTitle?: string;
  milestone?: string;
  note: string;
  required: boolean;
  minutes?: number;
  steps: OutlineStep[];
}
export interface OutlineStage {
  title: string;
  summary: string;
  steps: OutlineStep[];
}
export interface Outline {
  summary: string;
  stages: OutlineStage[];
  warnings: string[];
}

const MAX_LEVELS = 3;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const HOURS = /(?:^|[\s(~])(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?(?:\s*(\d+)\s*m(?:in(?:ute)?s?)?)?(?=$|[\s),.;])/i;
const MINS = /(?:^|[\s(~])(\d+)\s*m(?:in(?:ute)?s?)?(?=$|[\s),.;])/i;

function takeMinutes(text: string): { text: string; minutes?: number } {
  const h = HOURS.exec(text);
  if (h) return { text: text.replace(h[0], " "), minutes: Math.round(Number(h[1]) * 60 + Number(h[2] ?? 0)) };
  const m = MINS.exec(text);
  if (m) return { text: text.replace(m[0], " "), minutes: Number(m[1]) };
  return { text };
}

function parseLine(raw: string, n: number, warnings: string[]): OutlineStep {
  let text = raw.replace(/^\[[ xX]\]\s+/, "").trim();
  let required = true;
  const opt = /\s*[*_]*\(optional\)[*_]*/i;
  if (opt.test(text)) {
    required = false;
    text = text.replace(opt, "");
  }
  let note = "";
  const split = /\s+(?:—|--)\s+/.exec(text);
  if (split) {
    note = text.slice(split.index + split[0].length).trim();
    text = text.slice(0, split.index);
  }
  const t = takeMinutes(text);
  text = t.text.replace(/\s{2,}/g, " ").trim();
  const step: OutlineStep = { note: note.slice(0, 1000), required, minutes: t.minutes && t.minutes <= 6000 ? t.minutes : undefined, steps: [] };

  const wiki = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/.exec(text);
  if (wiki) return { ...step, itemTitle: wiki[1]!.trim() };
  const link = /^\[([^\]]+)\]\((\S+?)\)$/.exec(text);
  if (link) {
    const title = link[1]!.trim().slice(0, 200);
    if (isSafeHttpsUrl(link[2]!)) return { ...step, link: { url: normalizeUrl(link[2]!), title } };
    warnings.push(`Line ${n}: "${title}" has a link that is not https, so it became a checkpoint.`);
    return { ...step, milestone: title.slice(0, 160) };
  }
  const bare = /^(https:\/\/\S+)$/.exec(text);
  if (bare && isSafeHttpsUrl(bare[1]!)) {
    const url = normalizeUrl(bare[1]!);
    return { ...step, link: { url, title: new URL(url).hostname.replace(/^www\./, "") } };
  }
  return { ...step, milestone: (text || "Checkpoint").slice(0, 160) };
}

export function parseOutline(md: string): Outline {
  const warnings: string[] = [];
  const stages: OutlineStage[] = [];
  const intro: string[] = [];
  let stage: OutlineStage | null = null;
  // Open parents, from the top level down, with the indent each was written at.
  let stack: Array<{ indent: number; step: OutlineStep }> = [];
  let deepWarned = false;

  const lines = md.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  for (const [i, line] of lines.entries()) {
    const heading = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      stage = { title: heading[1]!.slice(0, 160), summary: "", steps: [] };
      stages.push(stage);
      stack = [];
      continue;
    }
    if (/^#\s/.test(line) || !line.trim()) continue;
    const b = BULLET.exec(line);
    if (!b) {
      // Plain text: the roadmap's summary before any stage, a stage's description after its heading.
      if (!stage) intro.push(line.trim());
      else if (!stage.steps.length) stage.summary = `${stage.summary} ${line.trim()}`.trim().slice(0, 1000);
      continue;
    }
    if (!stage) {
      stage = { title: "Roadmap", summary: "", steps: [] };
      stages.push(stage);
    }
    const indent = b[1]!.length;
    const step = parseLine(b[2]!, i + 1, warnings);
    while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
    if (stack.length >= MAX_LEVELS) {
      if (!deepWarned) warnings.push(`Line ${i + 1}: steps nest at most ${MAX_LEVELS} levels deep, so deeper lines were moved up a level.`);
      deepWarned = true;
      stack = stack.slice(0, MAX_LEVELS - 1);
    }
    (stack.length ? stack[stack.length - 1]!.step.steps : stage.steps).push(step);
    stack.push({ indent, step });
  }
  return { summary: intro.join(" ").slice(0, 2000), stages: stages.slice(0, 30), warnings };
}
