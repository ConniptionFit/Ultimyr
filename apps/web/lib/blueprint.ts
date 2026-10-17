import type { ObjectiveTreeNode } from "@/lib/certs";

export interface BlueprintEntry {
  title: string;
  weightBp: number;
  objectiveIds: string[];
}

/**
 * The exam's domain weights from the objective tree: one entry per domain that has a weight, covering the domain and its topics.
 * Returns an empty list when no domain has a weight (the exam is then drawn evenly from everything).
 */
export function blueprintFrom(tree: ObjectiveTreeNode[]): BlueprintEntry[] {
  return tree
    .filter((d) => (d.weightBp ?? 0) > 0)
    .map((d) => ({ title: d.title, weightBp: d.weightBp as number, objectiveIds: [d.id, ...(d.children ?? []).map((k) => k.id)] }));
}
