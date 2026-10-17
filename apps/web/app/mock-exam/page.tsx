"use client";

import { Swords } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { Loading } from "@/components/loading";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { blueprintFrom } from "@/lib/blueprint";
import type { ObjectiveTreeNode } from "@/lib/certs";
import { useDisplay } from "@/lib/display";
import { useNaming } from "@/lib/naming";
import { RequireSession } from "@/lib/require-session";
import type { Archive } from "@/lib/types";

const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-ink";
const ERRORS: Record<string, string> = { no_questions: "There are no published practice questions in that course yet.", not_found: "That course could not be found." };

function MockExam() {
  const { api } = useAuth();
  const { t } = useNaming();
  const { display } = useDisplay();
  const router = useRouter();
  const params = useSearchParams();
  const [archives, setArchives] = useState<Archive[] | null>(null);
  const [archive, setArchive] = useState(params.get("archive") ?? "");
  const [count, setCount] = useState(60);
  const [minutes, setMinutes] = useState(90);
  const [tree, setTree] = useState<ObjectiveTreeNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ archives: Archive[] }>("GET", "archives")
      .then((r) => {
        setArchives(r.archives);
        setArchive((cur) => cur || r.archives[0]?.id || "");
      })
      .catch(() => setArchives([]));
  }, [api]);
  useEffect(() => {
    if (!archive) return;
    api<{ objectives: ObjectiveTreeNode[] }>("GET", `archives/${archive}/objectives`)
      .then((r) => setTree(r.objectives))
      .catch(() => setTree([]));
  }, [api, archive]);
  const blueprint = useMemo(() => blueprintFrom(tree), [tree]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await api<{ id: string }>("POST", "mock-exams", {
        archiveId: archive,
        count,
        minutes,
        ...(blueprint.length ? { blueprint: blueprint.map((b) => ({ objectiveIds: b.objectiveIds, weightBp: b.weightBp })) } : {}),
        ...(display.extraTime ? { extraTimePct: display.extraTime } : {}),
      });
      router.push(`/attempts/${a.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (ERRORS[err.code] ?? err.issues[0] ?? "Could not start the exam.") : "Could not start the exam.");
      setBusy(false);
    }
  }

  if (!archives) return <Loading />;
  const given = blueprint.reduce((s, b) => s + b.weightBp, 0);
  return (
    <div className="ulti-fade max-w-xl space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl">
          <Swords aria-hidden /> {t("mockExam")}
        </h1>
        <p className="mt-1 text-sm text-muted">A full practice exam on a server clock with no feedback until the end, drawn from every quiz in the course. Questions you have not answered before come first. It counts toward your readiness estimate.</p>
      </div>
      {archives.length === 0 ? (
        <p className="text-muted">You have no {t("archives").toLowerCase()} yet.</p>
      ) : (
        <form onSubmit={start} className="space-y-5">
          <div className="space-y-1">
            <label htmlFor="m-archive" className="text-sm text-muted">
              {t("archive")}
            </label>
            <select id="m-archive" value={archive} onChange={(e) => setArchive(e.target.value)} className={input}>
              {archives.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="m-count" className="text-sm text-muted">
                Questions
              </label>
              <input id="m-count" type="number" min={10} max={200} value={count} onChange={(e) => setCount(Math.min(200, Math.max(10, Number(e.target.value) || 10)))} className={input} />
            </div>
            <div className="space-y-1">
              <label htmlFor="m-min" className="text-sm text-muted">
                Minutes
              </label>
              <input id="m-min" type="number" min={10} max={480} value={minutes} onChange={(e) => setMinutes(Math.min(480, Math.max(10, Number(e.target.value) || 10)))} className={input} />
            </div>
          </div>
          {blueprint.length > 0 ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted">Built to the exam&apos;s domain weights:</p>
              <ul>
                {blueprint.map((b) => (
                  <li key={b.title} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{b.title}</span>
                    <span className="shrink-0 text-muted">about {Math.round((count * b.weightBp) / 10_000)} questions ({b.weightBp / 100}%)</span>
                  </li>
                ))}
                {given < 10_000 && <li className="text-muted">The remaining {(10_000 - given) / 100}% is drawn from everything else.</li>}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">This course has no domain weights, so the exam is drawn evenly from all its questions. Add the exam objectives with their weights on the Coverage tab to follow the real blueprint.</p>
          )}
          {display.extraTime > 0 && <p className="text-sm text-muted">Your {display.extraTime}% extra time setting applies.</p>}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !archive}>
            Start the exam
          </Button>
        </form>
      )}
    </div>
  );
}

export default function MockExamPage() {
  return (
    <RequireSession>
      <Suspense fallback={<Loading />}>
        <MockExam />
      </Suspense>
    </RequireSession>
  );
}
