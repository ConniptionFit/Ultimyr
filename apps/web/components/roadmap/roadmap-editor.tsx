"use client";

import { ArrowDown, ArrowUp, Flag, IndentDecrease, IndentIncrease, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { useNaming } from "@/lib/naming";
import { RESOURCE_KINDS, type ItemSummary, type Resource, type ResourceKind } from "@/lib/types";
import { KIND_LABEL } from "./bits";
import { move, normalize, type Draft, type DraftStage } from "./roadmap-draft";

export function Editor(props: {
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

