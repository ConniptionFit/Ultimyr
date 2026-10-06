import type { ResourceKind, Roadmap, RoadmapStep } from "@/lib/types";

/** What a step looks like while it is being edited. Kept ids keep people's progress. */
export interface Draft {
  /** 0 is a step of the stage, 1 sits inside the step above it, 2 inside that. Saved as nested steps. */
  depth: number;
  id?: string;
  itemId?: string;
  resourceId?: string;
  resource?: { url: string; title: string; kind?: ResourceKind; minutes?: number };
  milestone?: string;
  label: string;
  note: string;
  required: boolean;
  minutes: number | null;
}
export interface DraftStage {
  id?: string;
  title: string;
  summary: string;
  steps: Draft[];
}

export function toDrafts(r: Roadmap): DraftStage[] {
  const flat = (x: RoadmapStep, depth: number): Draft[] => [
    {
      depth,
      id: x.id,
      itemId: x.item?.id,
      resourceId: x.resource?.id,
      milestone: x.kind === "milestone" ? x.title : undefined,
      label: x.kind === "milestone" ? (x.title ?? "") : x.kind === "item" ? x.item!.title : x.resource!.title,
      note: x.note,
      required: x.required,
      // A step's own estimate wins; only send one if it differs from the link's.
      minutes: x.kind === "resource" && x.minutes === x.resource!.minutes ? null : x.minutes,
    },
    ...x.children.flatMap((c) => flat(c, depth + 1)),
  ];
  return r.stages.map((s) => ({ id: s.id, title: s.title, summary: s.summary, steps: s.steps.flatMap((x) => flat(x, 0)) }));
}

export interface SaveStep {
  id?: string;
  note: string;
  required: boolean;
  minutes: number | null;
  steps?: SaveStep[];
  [k: string]: unknown;
}
/** Turn the flat, indented list back into nested steps. */
export function nest(steps: Draft[]): SaveStep[] {
  const roots: SaveStep[] = [];
  const open: SaveStep[] = []; // open[d] is the latest step at depth d
  for (const x of steps) {
    const node: SaveStep = {
      id: x.id,
      ...(x.itemId ? { itemId: x.itemId } : x.resourceId ? { resourceId: x.resourceId } : x.resource ? { resource: x.resource } : { milestone: x.milestone || x.label || "Checkpoint" }),
      note: x.note,
      required: x.required,
      minutes: x.minutes,
    };
    const d = Math.min(x.depth, open.length, 2);
    const parent = d > 0 ? open[d - 1] : undefined;
    if (parent) (parent.steps ??= []).push(node);
    else roots.push(node);
    open.length = d;
    open[d] = node;
  }
  return roots;
}

/** Keep indents sensible: the first step is at the top and nothing sits more than one level below the step above it. */
export function normalize(steps: Draft[]): Draft[] {
  let prev = -1;
  return steps.map((x) => {
    const depth = Math.max(0, Math.min(x.depth, prev + 1, 2));
    prev = depth;
    return depth === x.depth ? x : { ...x, depth };
  });
}

/**
 * Turn another course's roadmap into new, unsaved stages for this one. Links are copied (title, address, kind, minutes);
 * guides, decks and quizzes belong to their own course, so they come across as checkpoints with the same title.
 */
export function copiedStages(r: Roadmap): DraftStage[] {
  const flat = (x: RoadmapStep, depth: number): Draft[] => [
    {
      depth,
      label: x.kind === "milestone" ? (x.title ?? "Checkpoint") : x.kind === "item" ? x.item!.title : x.resource!.title,
      milestone: x.kind === "resource" ? undefined : x.kind === "item" ? x.item!.title : (x.title ?? "Checkpoint"),
      resource: x.kind === "resource" ? { url: x.resource!.url, title: x.resource!.title, kind: x.resource!.kind, minutes: x.resource!.minutes ?? undefined } : undefined,
      note: x.note,
      required: x.required,
      minutes: x.kind === "resource" && x.minutes === x.resource!.minutes ? null : x.minutes,
    },
    ...x.children.flatMap((c) => flat(c, depth + 1)),
  ];
  return r.stages.map((s) => ({ title: s.title, summary: s.summary, steps: s.steps.flatMap((x) => flat(x, 0)) }));
}

export function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
