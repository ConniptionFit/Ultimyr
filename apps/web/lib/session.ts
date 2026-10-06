import type { RoadmapStep } from "./types";

/** Minutes assumed for a step with no estimate, so a plan never treats it as free. */
export const DEFAULT_STEP_MINUTES = 10;

/** Leaf steps in path order: the things you actually do. */
export function leafSteps(steps: RoadmapStep[]): RoadmapStep[] {
  return steps.flatMap((x) => (x.children.length ? leafSteps(x.children) : [x]));
}

export interface SessionPlan {
  ids: string[];
  minutes: number;
}

/**
 * Today's session: from the current step on, take required steps in order until the minutes are used up. Always at
 * least one step, so a long lesson on a short day still gives a clear start. Steps already done do not count.
 */
export function planSession(leaves: RoadmapStep[], budget: number): SessionPlan {
  const todo = leaves.filter((x) => !x.done && x.required && x.effectiveRequired !== false);
  const ids: string[] = [];
  let minutes = 0;
  for (const x of todo) {
    const m = x.minutes ?? DEFAULT_STEP_MINUTES;
    if (ids.length > 0 && minutes + m > budget) break;
    ids.push(x.id);
    minutes += m;
    if (minutes >= budget) break;
  }
  return { ids, minutes };
}
