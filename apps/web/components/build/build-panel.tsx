"use client";

import { buildCoverage, buildQueue, type Depth, type QuizStats } from "@ultimyr/coverage";
import { useEffect, useMemo, useState } from "react";
import { Meter } from "@/components/charts";
import { PromptBox } from "@/components/build/prompt-box";
import { useAuth } from "@/lib/auth";
import { DEPTH_WORDS, continuePrompt } from "@/lib/build-prompt";
import type { ObjectiveTreeNode } from "@/lib/certs";
import { useNaming } from "@/lib/naming";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Build progress for an archive, and a prompt to hand the rest to an AI assistant. Editors only. */
export function BuildPanel({ archiveId, archiveTitle }: { archiveId: string; archiveTitle: string }) {
  const { api } = useAuth();
  const { t } = useNaming();
  const [tree, setTree] = useState<ObjectiveTreeNode[] | null>(null);
  const [stats, setStats] = useState<QuizStats | null>(null);
  const [depth, setDepth] = useState<Depth>("standard");

  useEffect(() => {
    let live = true;
    Promise.all([api<{ objectives: ObjectiveTreeNode[] }>("GET", `archives/${archiveId}/objectives`), api<QuizStats>("GET", `analytics/objectives?archive=${archiveId}`).catch(() => null)])
      .then(([o, s]) => live && (setTree(o.objectives), setStats(s)))
      .catch(() => live && setTree([]));
    return () => {
      live = false;
    };
  }, [api, archiveId]);

  const queue = useMemo(() => (tree?.length ? buildQueue(buildCoverage(tree, stats), depth, 1) : null), [tree, stats, depth]);
  if (tree === null) return null;

  return (
    <section aria-labelledby="build-h" className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 id="build-h" className="text-lg">
        {t("build")}
      </h2>
      {!queue ? (
        <p className="text-sm text-muted">Add the exam objectives below first (paste them, or ask your assistant to). Then it can write the guides, flashcards and questions for you.</p>
      ) : (
        <>
          <Meter value={queue.progressBp} label="Build progress" />
          <p className="text-sm text-muted" aria-live="polite">
            {queue.done ? "Everything wanted at this depth exists. Review the drafts and publish them." : `${Math.round(queue.progressBp / 100)}% built. Still to write: ${plural(queue.remaining.guides, "guide")}, ${plural(queue.remaining.cards, "flashcard")}, ${plural(queue.remaining.questions, "question")}.`}
          </p>
        </>
      )}
      <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
        Depth
        <select value={depth} onChange={(e) => setDepth(e.target.value as Depth)} className="min-w-0 max-w-full rounded-md border border-line bg-bg px-2 py-1">
          {(Object.keys(DEPTH_WORDS) as Depth[]).map((d) => (
            <option key={d} value={d}>
              {DEPTH_WORDS[d].label} ({DEPTH_WORDS[d].detail})
            </option>
          ))}
        </select>
      </label>
      {queue?.done ? null : <PromptBox label="Prompt to continue" prompt={continuePrompt(archiveTitle, archiveId, depth)} />}
    </section>
  );
}
