"use client";

import { buildCoverage, topGaps, type CoverageRow, type QuizStats } from "@ultimyr/coverage";
import { Check, CircleDashed, CircleDot, Dumbbell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Meter } from "@/components/charts";
import { Loading } from "@/components/loading";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { MASTERY_WORDS, STATUS_WORDS, type ObjectiveTreeNode } from "@/lib/certs";
import { objectiveLabel } from "@/lib/objectives";
import { pct } from "@/lib/quiz";

const ICON = { covered: Check, thin: CircleDot, gap: CircleDashed } as const;
const OUTLINE_HINT = "## 1.0 Mobile Devices (15%)\n- 1.1 Install and configure laptop hardware\n- 1.2 Compare display types\n## 2.0 Networking (20%)\n- 2.1 Compare TCP and UDP";

function plural(n: number, w: string) {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}

/** The exam objective coverage map for an archive: what each objective has behind it, and where the gaps are. */
export function CoveragePanel({ archiveId, canEdit }: { archiveId: string; canEdit: boolean }) {
  const { api } = useAuth();
  const router = useRouter();
  const [tree, setTree] = useState<ObjectiveTreeNode[] | null>(null);
  const [stats, setStats] = useState<QuizStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [note, setNote] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([
        api<{ objectives: ObjectiveTreeNode[] }>("GET", `archives/${archiveId}/objectives`),
        // The coverage map still works when quiz data is unavailable: questions then count as none.
        api<QuizStats>("GET", `analytics/objectives?archive=${archiveId}`).catch(() => null),
      ]);
      setTree(t.objectives);
      setStats(s);
    } catch {
      setTree([]);
      setError("Could not load the objectives.");
    }
  }, [api, archiveId]);
  useEffect(() => void load(), [load]);

  const cov = useMemo(() => (tree ? buildCoverage(tree, stats) : null), [tree, stats]);

  async function importOutline(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ added: number; updated: number; warnings: string[] }>("POST", `archives/${archiveId}/objectives/import`, { text: String(f.get("text")), replace: f.get("replace") === "on" });
      setNote([`Added ${plural(r.added, "line")}, updated ${r.updated}.`, ...r.warnings]);
      setImporting(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0] ?? err.code.replaceAll("_", " ")) : "Could not import that.");
    } finally {
      setBusy(false);
    }
  }

  async function drill(objectiveId: string) {
    try {
      const a = await api<{ id: string }>("POST", "drills", { archiveId, objectiveId, focus: "mixed", restart: true });
      router.push(`/attempts/${a.id}`);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "no_questions" ? "There are no published questions for that objective yet." : "Could not start a drill.");
    }
  }

  if (!tree || !cov) return <Loading />;
  const gaps = topGaps(cov, 3);

  const form = (
    <form onSubmit={importOutline} className="space-y-3 rounded-md border border-line p-4">
      <div className="space-y-1">
        <label htmlFor="obj-text" className="text-sm text-muted">
          Paste the exam objectives
        </label>
        <textarea id="obj-text" name="text" rows={8} required maxLength={60000} placeholder={OUTLINE_HINT} className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink" />
        <p className="text-xs text-muted">One heading per domain, with its weight in brackets, and one line per objective. Importing again updates what matches by code and never removes anything unless you tick the box below.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="replace" /> Replace the whole list (removes links on objectives that disappear)
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Import
        </Button>
        <Button type="button" variant="quiet" onClick={() => setImporting(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );

  if (!cov.rows.length)
    return (
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="rounded-lg border border-dashed border-line p-8 text-center">
          <p className="mx-auto max-w-md text-muted">
            No exam objectives yet. Add the official objective list for this certification and Ultimyr will show which ones your material covers well and which are still thin.
          </p>
        </div>
        {canEdit ? form : <p className="text-sm text-muted">An editor of this course can add them.</p>}
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-md border border-line p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Material and practice behind the exam</p>
            <p className="text-3xl tabular-nums">{cov.summary.coverageBp === null ? "-" : pct(cov.summary.coverageBp)}</p>
          </div>
          <p className="text-sm text-muted">
            {cov.summary.covered} covered · {cov.summary.thin} thin · {cov.summary.gap} gaps · {plural(cov.summary.objectives, "objective")}
          </p>
        </div>
        <Meter value={cov.summary.coverageBp ?? 0} label="Coverage" />
        <p className="text-xs text-muted">Covered means a study guide, deck or resource, at least 5 flashcards and 3 published practice questions. Thin counts half. Domains are weighted by their exam share when weights are set.</p>
        {cov.summary.unmappedQuestions > 0 && <p className="text-sm">{plural(cov.summary.unmappedQuestions, "practice question")} not linked to an objective yet.</p>}
        {!stats && <p className="text-sm text-muted">Practice question counts are unavailable right now, so they show as zero.</p>}
      </div>

      {gaps.length > 0 && (
        <section aria-labelledby="gaps-h" className="space-y-2">
          <h2 id="gaps-h" className="text-xl">
            Fix these first
          </h2>
          <ul className="space-y-1 text-sm">
            {gaps.map((g) => (
              <li key={g.id}>
                <strong>{objectiveLabel(g)}</strong> <span className="text-muted">needs {g.missing.join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {note.length > 0 && (
        <ul role="status" className="space-y-1 text-sm text-muted">
          {note.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <ul className="space-y-4">
        {cov.rows.map((d) => (
          <li key={d.id} className="rounded-md border border-line">
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3">
              <h3 className="min-w-0 flex-1 font-serif text-lg">
                {objectiveLabel(d)}
                {d.weightBp !== null && <span className="ml-2 text-sm text-muted">{pct(d.weightBp)} of the exam</span>}
              </h3>
              <Chip row={d} />
            </div>
            <ul className="divide-y divide-line">
              {(d.children?.length ? d.children : [d]).map((o) => (
                <Row key={o.id} o={o} onDrill={() => drill(o.id)} />
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {canEdit && (importing ? form : <Button variant="quiet" onClick={() => setImporting(true)}>Import or update objectives</Button>)}
    </div>
  );
}

function Chip({ row }: { row: CoverageRow }) {
  const Icon = ICON[row.status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs ${row.status === "gap" ? "text-danger" : row.status === "covered" ? "text-accent" : ""}`}>
      <Icon size={12} aria-hidden /> {STATUS_WORDS[row.status]}
    </span>
  );
}

function Row({ o, onDrill }: { o: CoverageRow; onDrill: () => void }) {
  const c = o.counts;
  const parts = [plural(c.guides + c.decks, "guide or deck"), plural(c.cards, "flashcard"), plural(o.questions, "question"), c.resources ? plural(c.resources, "resource") : null].filter(Boolean);
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p>{objectiveLabel(o)}</p>
        <p className="text-sm text-muted">{parts.join(" · ")}</p>
        {o.missing.length > 0 && o.status !== "gap" && <p className="text-sm text-muted">Needs {o.missing.join(", ")}.</p>}
        {o.mastery !== "unknown" && o.accuracyBp !== null && (
          <p className={`text-sm ${o.mastery === "weak" ? "text-danger" : "text-muted"}`}>
            {MASTERY_WORDS[o.mastery]}: you score {pct(o.accuracyBp)} on {plural(o.answered, "answer")}
          </p>
        )}
      </div>
      <Chip row={o} />
      {o.questions > 0 && (
        <Button variant="quiet" onClick={onDrill} aria-label={`Drill ${objectiveLabel(o)}`}>
          <Dumbbell size={14} aria-hidden /> Drill
        </Button>
      )}
    </li>
  );
}
