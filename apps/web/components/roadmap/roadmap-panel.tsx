"use client";

import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, FileQuestion, FileText, Flag, IndentDecrease, IndentIncrease, Layers, Minus, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { notesMessage, type ArchiveNotes, type ScaffoldResult } from "@/lib/notes";
import { RESOURCE_KINDS, type ItemSummary, type Resource, type ResourceKind, type Roadmap, type RoadmapStep } from "@/lib/types";
import { ExternalLinkText, KIND_ICON, KIND_LABEL, ProgressBar, minutesText, totalsText } from "./bits";
import { NotePane } from "./note-pane";

const ITEM_ICON = { guide: BookOpen, deck: Layers, quiz: FileQuestion } as const;

/** What a step looks like while it is being edited. Kept ids keep people's progress. */
interface Draft {
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
interface DraftStage {
  id?: string;
  title: string;
  summary: string;
  steps: Draft[];
}

function toDrafts(r: Roadmap): DraftStage[] {
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

interface SaveStep {
  id?: string;
  note: string;
  required: boolean;
  minutes: number | null;
  steps?: SaveStep[];
  [k: string]: unknown;
}
/** Turn the flat, indented list back into nested steps. */
function nest(steps: Draft[]): SaveStep[] {
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
function normalize(steps: Draft[]): Draft[] {
  let prev = -1;
  return steps.map((x) => {
    const depth = Math.max(0, Math.min(x.depth, prev + 1, 2));
    prev = depth;
    return depth === x.depth ? x : { ...x, depth };
  });
}

function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

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
  const [notes, setNotes] = useState<ArchiveNotes | null>(null);
  const [openNote, setOpenNote] = useState<{ id: string; title: string } | null>(null);

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

  async function scaffold() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ScaffoldResult>("POST", `notes/archives/${archiveId}/scaffold`);
      setWarnings([`Notes: ${r.created} created, ${r.existing} already there${r.failed.length ? `, ${r.failed.length} failed` : ""}.`]);
      await loadNotes();
    } catch (e) {
      setError(e instanceof ApiError ? notesMessage(e.code) : "Could not create the notes.");
    } finally {
      setBusy(false);
    }
  }

  /** Keeps each note's `status` property in step with its tick. Best effort: a tick never fails because notes are down. */
  function syncStatus(step: RoadmapStep, done: boolean) {
    if (!notes?.connected) return;
    const walk = (x: RoadmapStep): RoadmapStep[] => [x, ...x.children.flatMap(walk)];
    for (const x of walk(step)) {
      if (notes.steps[x.id]) void api("POST", `notes/steps/${x.id}/status`, { status: done ? "done" : "todo" }).catch(() => {});
    }
  }

  async function tick(step: RoadmapStep, done: boolean) {
    setError(null);
    try {
      await api("PUT", `roadmap/steps/${step.id}/progress`, { done });
      syncStatus(step, done);
      setRoad(await api<Roadmap>("GET", `archives/${archiveId}/roadmap`));
      onChanged?.();
    } catch {
      setError("Could not save that tick.");
      await load();
    }
  }

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
            {road.next ? (
              <p className="text-sm">
                <span className="text-muted">Next up: </span>
                <a href={`#step-${road.next.stepId}`} className="text-accent underline">
                  {road.next.title}
                </a>
              </p>
            ) : (
              road.totals.required > 0 && <p className="text-sm text-accent">{copy("roadmapDone")}</p>
            )}
          </div>
          {notes?.enabled && !notes.connected && (
            <p className="text-sm text-muted">
              Keep a note for every step in Obsidian: <Link href="/settings#notes" className="text-accent underline">connect Fast Note Sync</Link>.
            </p>
          )}
          {notes?.connected && !notes.scaffolded && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3 text-sm">
              <span className="text-muted">Create one note per step in your Obsidian vault (never overwrites anything).</span>
              <Button type="button" onClick={scaffold} disabled={busy}>
                <NotebookPen size={16} aria-hidden /> Create notes
              </Button>
            </div>
          )}
          {notes?.connected && notes.scaffolded && (
            <p className="flex flex-wrap items-center gap-3 text-sm text-muted">
              Notes are on: use the note icon on a step to read it beside your notes.
              <Button type="button" variant="quiet" onClick={scaffold} disabled={busy}>
                Add notes for new steps
              </Button>
            </p>
          )}
          <div className={openNote ? "grid gap-4 lg:grid-cols-2 lg:items-start" : ""}>
          <ol className="space-y-8">
            {road.stages.map((st, i) => {
              return (
                <li key={st.id}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3 className="text-lg">
                      <span className="text-muted">{i + 1}. </span>
                      {st.title}
                    </h3>
                    <span className="text-xs text-muted">
                      {st.progress.done}/{st.progress.total}
                    </span>
                  </div>
                  {st.summary && <p className="mb-2 text-sm text-muted">{st.summary}</p>}
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {st.steps.length === 0 && <li className="p-3 text-sm text-muted">Nothing in this stage yet.</li>}
                    {st.steps.map((x) => (
                      <StepRow key={x.id} step={x} depth={0} onTick={tick} notes={notes?.connected ? notes.steps : undefined} openId={openNote?.id} onNote={setOpenNote} />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ol>
          {openNote && (
            <div className="lg:sticky lg:top-4">
              <NotePane stepId={openNote.id} title={openNote.title} onClose={() => setOpenNote(null)} />
            </div>
          )}
          </div>
        </>
      )}
    </div>
  );
}

interface RowProps {
  onTick: (step: RoadmapStep, done: boolean) => void;
  /** Steps that have a note, when notes are connected. */
  notes?: ArchiveNotes["steps"];
  openId?: string;
  onNote: (n: { id: string; title: string }) => void;
}

function StepRow({ step, depth, onTick, notes, openId, onNote }: { step: RoadmapStep; depth: number } & RowProps) {
  const { t } = useNaming();
  const [open, setOpen] = useState(!step.done);
  const label = step.kind === "milestone" ? step.title! : step.kind === "item" ? step.item!.title : step.resource!.title;
  const Icon = step.kind === "milestone" ? Flag : step.kind === "item" ? ITEM_ICON[step.item!.kind] : KIND_ICON[step.resource!.kind];
  const draftTarget = (step.item?.status ?? step.resource?.status) === "draft";
  const parent = step.children.length > 0;
  const partial = parent && !step.done && (step.progress?.done ?? 0) > 0;
  const optional = !step.required || step.effectiveRequired === false;
  const meta = [
    step.kind === "item" ? t(step.item!.kind) : step.kind === "resource" ? `${KIND_LABEL[step.resource!.kind]} · ${step.resource!.provider}` : "Checkpoint",
    parent ? `${step.progress!.done} of ${step.progress!.total} done` : null,
    minutesText(parent ? (step.minutesTotal ?? step.minutes) : step.minutes),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li id={`step-${step.id}`} className={depth ? "border-t border-line first:border-t-0" : ""}>
      <div className="flex items-start gap-3 p-3" style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}>
        {parent ? (
          <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${label}`} onClick={() => setOpen(!open)} className="mt-0.5 text-muted hover:text-ink">
            {open ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
          </button>
        ) : (
          depth > 0 && <span className="w-[18px] shrink-0" aria-hidden />
        )}
        <button
          role="checkbox"
          aria-checked={partial ? "mixed" : step.done}
          aria-label={`${step.done ? "Mark not done" : "Mark done"}: ${label}${parent ? " and everything inside it" : ""}`}
          onClick={() => onTick(step, !step.done)}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${step.done ? "border-accent bg-accent text-accent-ink" : partial ? "border-accent text-accent" : "border-line hover:border-accent"}`}
        >
          {step.done ? <Check size={14} aria-hidden /> : partial ? <Minus size={14} aria-hidden /> : null}
        </button>
        <Icon size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className={step.done ? "text-muted line-through decoration-line" : ""}>
            {step.kind === "item" ? (
              <Link href={`/items/${step.item!.id}`} className="text-accent underline">
                {label}
              </Link>
            ) : step.kind === "resource" ? (
              <ExternalLinkText resource={step.resource!} />
            ) : (
              label
            )}
            {optional && <span className="ml-2 rounded-full border border-line px-2 text-xs text-muted no-underline">optional</span>}
            {draftTarget && <span className="ml-2 rounded-full border border-line px-2 text-xs text-muted">draft</span>}
          </p>
          <p className="text-xs text-muted">{meta}</p>
          {step.note && <p className="mt-1 text-sm text-ink/80">{step.note}</p>}
          {step.kind === "resource" && step.resource!.summary && <p className="mt-1 text-sm text-muted">{step.resource!.summary}</p>}
        </div>
        {notes?.[step.id] && (
          <button
            type="button"
            aria-label={`Notes for ${label}`}
            aria-pressed={openId === step.id}
            onClick={() => onNote({ id: step.id, title: label })}
            className={`mt-0.5 shrink-0 rounded-md p-1 ${openId === step.id ? "bg-surface text-accent" : "text-muted hover:text-ink"}`}
          >
            <NotebookPen size={18} aria-hidden />
          </button>
        )}
      </div>
      {parent && open && (
        <ul>
          {step.children.map((c) => (
            <StepRow key={c.id} step={c} depth={depth + 1} onTick={onTick} notes={notes} openId={openId} onNote={onNote} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Editor(props: {
  stages: DraftStage[];
  setStages: (s: DraftStage[]) => void;
  summary: string;
  setSummary: (s: string) => void;
  items: ItemSummary[];
  resources: Resource[];
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { stages, setStages, items, resources } = props;
  const { t } = useNaming();
  const setStage = (i: number, patch: Partial<DraftStage>) => setStages(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setSteps = (i: number, steps: Draft[]) => setStage(i, { steps: normalize(steps) });
  const setStep = (i: number, k: number, patch: Partial<Draft>) => setSteps(i, stages[i]!.steps.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  const addStep = (i: number, step: Omit<Draft, "depth">) => setSteps(i, [...stages[i]!.steps, { ...step, depth: 0 }]);
  const [linking, setLinking] = useState<number | null>(null);

  function addPicked(i: number, value: string) {
    if (!value) return;
    const [type, id] = value.split(":") as ["item" | "resource", string];
    if (type === "item") {
      const it = items.find((x) => x.id === id);
      if (it) addStep(i, { itemId: it.id, label: it.title, note: "", required: true, minutes: null });
    } else {
      const r = resources.find((x) => x.id === id);
      if (r) addStep(i, { resourceId: r.id, label: r.title, note: "", required: true, minutes: null });
    }
  }

  function addLink(i: number, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const minutes = Number(f.get("minutes")) || undefined;
    const title = String(f.get("title")).trim();
    addStep(i, { resource: { url: String(f.get("url")).trim(), title, kind: (String(f.get("kind")) || undefined) as ResourceKind | undefined, minutes }, label: title, note: "", required: true, minutes: null });
    setLinking(null);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="rm-summary" className="text-sm text-muted">
          About this {t("roadmap").toLowerCase()} (who it is for, how long it takes)
        </label>
        <textarea id="rm-summary" value={props.summary} onChange={(e) => props.setSummary(e.target.value)} rows={2} maxLength={2000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
      </div>

      {stages.map((st, i) => (
        <fieldset key={st.id ?? `new-${i}`} className="space-y-3 rounded-md border border-line p-3">
          <legend className="px-1 text-sm text-muted">Stage {i + 1}</legend>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field id={`st-${i}`} label="Stage name" value={st.title} onChange={(e) => setStage(i, { title: e.target.value })} maxLength={160} />
            </div>
            <Button type="button" variant="quiet" aria-label="Move stage up" disabled={i === 0} onClick={() => setStages(move(stages, i, -1))}>
              <ArrowUp size={16} />
            </Button>
            <Button type="button" variant="quiet" aria-label="Move stage down" disabled={i === stages.length - 1} onClick={() => setStages(move(stages, i, 1))}>
              <ArrowDown size={16} />
            </Button>
            <Button type="button" variant="quiet" aria-label="Remove stage" className="text-danger" onClick={() => confirm("Remove this stage and its steps? Anyone's ticks on them are lost.") && setStages(stages.filter((_, j) => j !== i))}>
              <Trash2 size={16} />
            </Button>
          </div>
          <Field id={`st-sum-${i}`} label="Short description (optional)" value={st.summary} onChange={(e) => setStage(i, { summary: e.target.value })} maxLength={1000} />

          <ul className="space-y-2">
            {st.steps.map((x, k) => (
              <li key={x.id ?? `s-${k}`} style={{ marginLeft: `${x.depth * 1.5}rem` }} className="space-y-2 rounded-md border border-line p-2">
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {x.itemId ? "Item: " : x.resourceId || x.resource ? "Link: " : "Checkpoint: "}
                    {x.label}
                    {x.depth > 0 && <span className="ml-2 text-xs text-muted">inside the step above</span>}
                  </span>
                  <Button type="button" variant="quiet" aria-label="Move step out one level" disabled={x.depth === 0} onClick={() => setStep(i, k, { depth: x.depth - 1 })}>
                    <IndentDecrease size={14} />
                  </Button>
                  <Button type="button" variant="quiet" aria-label="Move step into the step above" disabled={k === 0 || x.depth > st.steps[k - 1]!.depth || x.depth >= 2} onClick={() => setStep(i, k, { depth: x.depth + 1 })}>
                    <IndentIncrease size={14} />
                  </Button>
                  <Button type="button" variant="quiet" aria-label="Move step up" disabled={k === 0} onClick={() => setSteps(i, move(st.steps, k, -1))}>
                    <ArrowUp size={14} />
                  </Button>
                  <Button type="button" variant="quiet" aria-label="Move step down" disabled={k === st.steps.length - 1} onClick={() => setSteps(i, move(st.steps, k, 1))}>
                    <ArrowDown size={14} />
                  </Button>
                  <Button type="button" variant="quiet" aria-label="Remove step" className="text-danger" onClick={() => setSteps(i, st.steps.filter((_, j) => j !== k))}>
                    <Trash2 size={14} />
                  </Button>
                </div>
                {!x.itemId && !x.resourceId && !x.resource && <Field id={`m-${i}-${k}`} label="Checkpoint text" value={x.milestone ?? x.label} onChange={(e) => setStep(i, k, { milestone: e.target.value, label: e.target.value })} maxLength={160} />}
                <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
                  <Field id={`n-${i}-${k}`} label="Note for the learner (optional)" value={x.note} onChange={(e) => setStep(i, k, { note: e.target.value })} maxLength={1000} />
                  <Field id={`mi-${i}-${k}`} label="Minutes" type="number" min={1} max={6000} value={x.minutes ?? ""} onChange={(e) => setStep(i, k, { minutes: Number(e.target.value) || null })} />
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" checked={x.required} onChange={(e) => setStep(i, k, { required: e.target.checked })} /> Required
                  </label>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`pick-${i}`}>
              Add an item or saved link to stage {i + 1}
            </label>
            <select id={`pick-${i}`} value="" onChange={(e) => addPicked(i, e.target.value)} className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
              <option value="">Add from this {t("archive").toLowerCase()}…</option>
              {items.length > 0 && (
                <optgroup label="Material">
                  {items.map((it) => (
                    <option key={it.id} value={`item:${it.id}`}>
                      {t(it.kind)}: {it.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {resources.length > 0 && (
                <optgroup label={t("resources")}>
                  {resources.map((r) => (
                    <option key={r.id} value={`resource:${r.id}`}>
                      {KIND_LABEL[r.kind]}: {r.title}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <Button type="button" variant="quiet" onClick={() => setLinking(linking === i ? null : i)}>
              <Plus size={14} aria-hidden /> New link
            </Button>
            <Button type="button" variant="quiet" onClick={() => addStep(i, { milestone: "Checkpoint", label: "Checkpoint", note: "", required: true, minutes: null })}>
              <Flag size={14} aria-hidden /> Checkpoint
            </Button>
          </div>
          {linking === i && (
            <form onSubmit={(e) => addLink(i, e)} className="grid gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field id={`l-url-${i}`} name="url" type="url" label="Link (https)" placeholder="https://www.youtube.com/watch?v=..." required pattern="https://.*" maxLength={2000} />
              </div>
              <Field id={`l-title-${i}`} name="title" label="Title" required maxLength={200} />
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor={`l-kind-${i}`} className="text-sm text-muted">
                    Kind
                  </label>
                  <select id={`l-kind-${i}`} name="kind" defaultValue="" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                    <option value="">Auto</option>
                    {RESOURCE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <Field id={`l-min-${i}`} name="minutes" type="number" min={1} max={6000} label="Minutes" />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit">Add link</Button>
                <Button type="button" variant="quiet" onClick={() => setLinking(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </fieldset>
      ))}

      <Button type="button" variant="quiet" onClick={() => setStages([...stages, { title: `Week ${stages.length + 1}`, summary: "", steps: [] }])} disabled={stages.length >= 30}>
        <Plus size={14} aria-hidden /> Add stage
      </Button>

      {props.error && (
        <p role="alert" className="text-sm text-danger">
          {props.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={props.onSave} disabled={props.busy}>
          Save {t("roadmap").toLowerCase()}
        </Button>
        <Button variant="quiet" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
