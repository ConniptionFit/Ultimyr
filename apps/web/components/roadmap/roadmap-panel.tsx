"use client";

import { CatalogIcon } from "@/components/catalog-icon";
import { FileText, Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import type { ArchiveNotes } from "@/lib/notes";
import { leafSteps } from "@/lib/session";
import type { ItemSummary, Resource, Roadmap, RoadmapStep } from "@/lib/types";
import { ProgressBar, totalsText } from "./bits";
import { NoteFinder, PathStats, SessionBar, StageDigest, useSessionPlan } from "./path-tools";
import { Editor } from "./roadmap-editor";
import { copiedStages, nest, toDrafts, type DraftStage } from "./roadmap-draft";
import { StepRow } from "./step-row";


export function RoadmapPanel({ archiveId, items, canEdit, onChanged }: { archiveId: string; items: ItemSummary[]; canEdit: boolean; onChanged?: () => void }) {
  const { api } = useAuth();
  const { t, copy } = useNaming();
  const [road, setRoad] = useState<Roadmap | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftStage[] | null>(null);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [others, setOthers] = useState<{ id: string; title: string }[] | null>(null);
  const [notes, setNotes] = useState<ArchiveNotes | null>(null);
  // Guided is the default: the step you are on opens in place, with its video, material, notes and quiz, one after another.
  const [guided, setGuidedState] = useState(true);
  const advanceTo = useRef<string | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem("ultimyr_path_view") === "compact") setGuidedState(false);
    } catch {}
  }, []);
  const setGuided = (g: boolean) => {
    setGuidedState(g);
    try {
      localStorage.setItem("ultimyr_path_view", g ? "guided" : "compact");
    } catch {}
  };

  const loadNotes = useCallback(async () => {
    try {
      setNotes(await api<ArchiveNotes>("GET", `notes/archives/${archiveId}`));
    } catch {
      setNotes(null); // notes are optional: the roadmap works without them
    }
  }, [api, archiveId]);

  const load = useCallback(async () => {
    try {
      setRoad(await api<Roadmap>("GET", `archives/${archiveId}/roadmap`));
      if (canEdit) setResources((await api<{ resources: Resource[] }>("GET", `archives/${archiveId}/resources`)).resources);
    } catch {
      setError("Could not load the roadmap.");
    }
  }, [api, archiveId, canEdit]);
  useEffect(() => {
    void load();
    void loadNotes();
  }, [load, loadNotes]);

  /** Keeps each note's `status` property in step with its tick. Best effort: a tick never fails because notes are down. */
  function syncStatus(step: RoadmapStep, done: boolean) {
    if (!notes?.connected) return;
    const walk = (x: RoadmapStep): RoadmapStep[] => [x, ...x.children.flatMap(walk)];
    for (const x of walk(step)) {
      if (notes.steps[x.id]) void api("POST", `notes/steps/${x.id}/status`, { status: done ? "done" : "todo" }).catch(() => {});
    }
  }

  // Keyboard: J next step, K previous step, D done (and on to the next). Ignored while typing.
  const [cursor, setCursor] = useState<string | null>(null);
  const leaves = useMemo(() => (road ? road.stages.flatMap((st) => leafSteps(st.steps)) : []), [road]);
  const { minutes: sessionMinutes, setMinutes: setSessionMinutes, plan: sessionPlan } = useSessionPlan(leaves);
  const [digest, setDigest] = useState<string | null>(null);
  const titleOf = (id: string) => {
    const x = leaves.find((l) => l.id === id);
    return x ? (x.kind === "milestone" ? (x.title ?? null) : x.kind === "item" ? x.item!.title : x.resource!.title) : null;
  };
  const leavesRef = useRef(leaves);
  leavesRef.current = leaves;
  const cursorRef = useRef<string | null>(null);
  cursorRef.current = cursor ?? road?.next?.stepId ?? null;
  const tickRef = useRef<(s: RoadmapStep, d: boolean, a?: boolean) => void>(() => {});
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k" && k !== "d") return;
      const list = leavesRef.current;
      if (!list.length) return;
      const at = Math.max(0, list.findIndex((x) => x.id === cursorRef.current));
      if (k === "d") {
        const cur = list[at];
        if (cur) tickRef.current(cur, !cur.done, !cur.done);
        return;
      }
      const next = list[Math.min(list.length - 1, Math.max(0, at + (k === "j" ? 1 : -1)))];
      if (!next) return;
      setCursor(next.id);
      document.getElementById(`step-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Opened from Continue (?step=...): scroll to that step once the path has loaded.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !road?.exists) return;
    const id = new URLSearchParams(window.location.search).get("step");
    jumped.current = true;
    if (id) requestAnimationFrame(() => document.getElementById(`step-${id}`)?.scrollIntoView({ block: "start" }));
  }, [road]);

  // After "Done, next step", bring the next step into view once the new state has rendered.
  useEffect(() => {
    if (!advanceTo.current || !road) return;
    const id = road.next?.stepId;
    advanceTo.current = null;
    if (id) requestAnimationFrame(() => document.getElementById(`step-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [road]);

  async function tick(step: RoadmapStep, done: boolean, advance = false) {
    setError(null);
    try {
      await api("PUT", `roadmap/steps/${step.id}/progress`, { done });
      syncStatus(step, done);
      if (advance) advanceTo.current = step.id;
      setRoad(await api<Roadmap>("GET", `archives/${archiveId}/roadmap`));
      onChanged?.();
    } catch {
      setError("Could not save that tick.");
      await load();
    }
  }

  tickRef.current = tick;

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const stages = draft.map((s) => ({
        id: s.id,
        title: s.title.trim() || "Untitled stage",
        summary: s.summary,
        steps: nest(s.steps),
      }));
      setRoad(await api<Roadmap>("PUT", `archives/${archiveId}/roadmap`, { summary, stages, source: "human", status: road?.status ?? "published" }));
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (e.issues[0] ?? e.code.replaceAll("_", " ")) : "Could not save the roadmap.");
    } finally {
      setBusy(false);
    }
  }

  async function importOutline(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const mode = String(f.get("mode")) === "replace" ? "replace" : "append";
    if (mode === "replace" && road?.exists && !confirm("Replace the whole roadmap? Anyone's ticks on the current steps are lost.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<Roadmap & { warnings: string[] }>("POST", `archives/${archiveId}/roadmap/outline`, { outline: String(f.get("outline")), mode, source: "human" });
      setRoad(res);
      setWarnings(res.warnings);
      setPasting(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0] ?? err.code.replaceAll("_", " ")) : "Could not import that outline.");
    } finally {
      setBusy(false);
    }
  }

  async function loadOthers() {
    if (others) return;
    try {
      const r = await api<{ archives: { id: string; title: string; relation: string }[] }>("GET", "archives");
      setOthers(r.archives.filter((x) => x.id !== archiveId).map((x) => ({ id: x.id, title: x.title })));
    } catch {
      setOthers([]);
    }
  }

  async function copyFrom(otherId: string) {
    if (!otherId) return;
    setError(null);
    try {
      const other = await api<Roadmap>("GET", `archives/${otherId}/roadmap`);
      if (!other.exists || !other.stages.length) return setError("That course has no roadmap to copy.");
      setSummary(road?.summary || other.summary);
      setDraft([...(road?.exists ? toDrafts(road) : []), ...copiedStages(other)]);
    } catch {
      setError("Could not read that roadmap.");
    }
  }

  async function setStatus(status: "draft" | "published") {
    setError(null);
    try {
      setRoad(await api<Roadmap>("PATCH", `archives/${archiveId}/roadmap`, { status }));
    } catch {
      setError("Could not change the roadmap status.");
    }
  }

  if (!road) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <p className="text-muted">{copy("loading")}</p>;

  if (draft) {
    return (
      <Editor
        stages={draft}
        setStages={setDraft}
        summary={summary}
        setSummary={setSummary}
        items={items}
        resources={resources}
        busy={busy}
        error={error}
        onSave={save}
        onCancel={() => {
          setDraft(null);
          setError(null);
        }}
      />
    );
  }

  const startEdit = () => {
    setSummary(road.summary);
    setDraft(road.exists ? toDrafts(road) : [{ title: "Week 1", summary: "", steps: [] }]);
  };

  const noteSaved = (stepId: string, has: boolean) =>
    setNotes((n) => {
      if (!n || !!n.steps[stepId] === has) return n;
      const steps = { ...n.steps };
      if (has) steps[stepId] = { path: null, obsidianUrl: null };
      else delete steps[stepId];
      return { ...n, steps };
    });
  const rail = road.stages.length > 1 && (
    <nav aria-label={t("stages")} className="sticky top-0 z-10 -mx-4 overflow-x-auto bg-bg/95 px-4 py-2 backdrop-blur">
      <ul className="flex gap-2 text-sm">
        {road.stages.map((st, i) => (
          <li key={st.id} className="shrink-0">
            <a href={`#stage-${st.id}`} className={`block rounded-full border px-3 py-1 ${st.progress.total > 0 && st.progress.done === st.progress.total ? "border-accent text-ink" : "border-line text-muted hover:text-ink"}`}>
              {i + 1}. {st.title} <span className="text-xs">{st.progress.done}/{st.progress.total}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
  const list = (
    <ol className="space-y-8">
      {road.stages.map((st, i) => (
        <li key={st.id} id={`stage-${st.id}`} className="scroll-mt-24">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="flex items-center gap-2 text-lg">
              <span className="text-muted">{i + 1}. </span>
              {st.icon?.name && <CatalogIcon name={st.icon.name} size={18} className="shrink-0 text-muted" />}
              {st.title}
            </h3>
            <span className="flex items-center gap-3 text-xs text-muted">
              {notes && (
                <button type="button" aria-expanded={digest === st.id} onClick={() => setDigest(digest === st.id ? null : st.id)} className="underline hover:text-ink">
                  {digest === st.id ? "Hide my notes" : "My notes"}
                </button>
              )}
              {st.progress.done}/{st.progress.total}
            </span>
          </div>
          {digest === st.id && (
            <div className="mb-2">
              <StageDigest archiveId={archiveId} steps={leafSteps(st.steps).map((x) => x.id)} titleOf={titleOf} />
            </div>
          )}
          {st.summary && <p className="mb-2 text-sm text-muted">{st.summary}</p>}
          {!!st.tagSet?.length && (
            <p className="mb-2 flex flex-wrap gap-1 text-xs text-muted" aria-label="Tags">
              {st.tagSet.map((tag) => (
                <span key={tag} className="rounded-full border border-line px-2 py-0.5">
                  {tag.replace(/^(topic|content-type):/, "").replaceAll("-", " ")}
                </span>
              ))}
            </p>
          )}
          <ul className="divide-y divide-line rounded-md border border-line">
            {st.steps.length === 0 && <li className="p-3 text-sm text-muted">Nothing in this stage yet.</li>}
            {st.steps.map((x) => (
              <StepRow key={x.id} step={x} depth={0} onTick={tick} archiveId={archiveId} notes={notes} onNoteSaved={noteSaved} guided={guided} currentId={road.next?.stepId ?? null} cursorId={cursor} today={sessionPlan?.ids ?? null} returnTo={`/archives/${archiveId}#roadmap`} />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="quiet" onClick={startEdit}>
            <Pencil size={16} aria-hidden /> {road.exists ? "Edit" : "Build"} {t("roadmap").toLowerCase()}
          </Button>
          <Button variant="quiet" onClick={() => setPasting(!pasting)}>
            <FileText size={16} aria-hidden /> Paste an outline
          </Button>
          <label className="sr-only" htmlFor="copy-from">
            {t("copyRoadmap")} from another course
          </label>
          <select id="copy-from" value="" onFocus={loadOthers} onChange={(e) => void copyFrom(e.target.value)} className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
            <option value="">{t("copyRoadmap")} from another {t("archive").toLowerCase()}…</option>
            {(others ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          {road.exists && road.status === "draft" && <Button onClick={() => setStatus("published")}>Publish</Button>}
          {road.exists && road.status === "published" && (
            <Button variant="quiet" onClick={() => setStatus("draft")}>
              Unpublish
            </Button>
          )}
          {road.status === "draft" && <span className="rounded-full border border-line px-2 text-xs text-muted">draft: only editors see this</span>}
        </div>
      )}

      {pasting && (
        <form onSubmit={importOutline} className="space-y-3 rounded-md border border-line p-4">
          <div className="space-y-1">
            <label htmlFor="outline" className="text-sm text-muted">
              Outline
            </label>
            <textarea
              id="outline"
              name="outline"
              required
              rows={10}
              maxLength={200000}
              placeholder={"## Week 1: Foundations\n- [Course hub](https://example.com/course) 90m\n  - [Lesson 1](https://youtu.be/abc) 12m\n  - [[A guide in this course]]\n- Take a practice exam (optional) -- aim for 70%"}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink"
            />
            <p className="text-xs text-muted">
              A line starting with ## is a stage. Bullets are steps, indented up to three levels. [Title](https://link) adds a link, 12m or 1h30m adds minutes, [[Title]] picks one of your own guides, decks or quizzes, (optional) makes it optional, and text after -- is a note.
            </p>
          </div>
          <fieldset className="flex gap-4 text-sm">
            <legend className="sr-only">What to do with it</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="append" defaultChecked /> Add to the end
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="mode" value="replace" /> Replace the roadmap
            </label>
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Import
            </Button>
            <Button type="button" variant="quiet" onClick={() => setPasting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {warnings.length > 0 && (
        <ul role="status" className="space-y-1 rounded-md border border-line p-3 text-sm text-muted">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {!road.exists || !road.stages.length ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-muted">{copy("emptyRoadmap")}</p>
      ) : (
        <>
          {road.summary && <p className="max-w-prose whitespace-pre-line text-ink/90">{road.summary}</p>}
          <div className="space-y-2">
            <ProgressBar totals={road.totals} label={`${t("roadmap")} progress`} />
            <p className="text-sm text-muted">
              {road.totals.percent}% · {totalsText(road.totals)}
            </p>
            <p className="hidden text-xs text-muted md:block">Keys: J next step, K previous step, D done.</p>
            <div className="flex flex-wrap items-center justify-between gap-2" role="group" aria-label="How to show the steps">
              {road.next ? (
                <p className="text-sm">
                  <span className="text-muted">Next up: </span>
                  <a href={`#step-${road.next.stepId}`} className="text-accent underline">
                    {road.next.title}
                  </a>
                </p>
              ) : (
                <span />
              )}
              <span className="flex gap-1 text-sm">
                <button type="button" aria-pressed={guided} onClick={() => setGuided(true)} className={`rounded-md border px-2 py-1 ${guided ? "border-accent text-ink" : "border-line text-muted hover:text-ink"}`}>
                  Guided
                </button>
                <button type="button" aria-pressed={!guided} onClick={() => setGuided(false)} className={`rounded-md border px-2 py-1 ${!guided ? "border-accent text-ink" : "border-line text-muted hover:text-ink"}`}>
                  Compact
                </button>
              </span>
            </div>
            {!road.next && road.totals.required > 0 && <p className="text-sm text-accent">{copy("roadmapDone")}</p>}
          </div>
          <PathStats archiveId={archiveId} />
          <SessionBar minutes={sessionMinutes} setMinutes={setSessionMinutes} plan={sessionPlan} />
          {notes && <NoteFinder archiveId={archiveId} titleOf={titleOf} />}
          {rail}
          {list}
        </>
      )}
    </div>
  );
}

