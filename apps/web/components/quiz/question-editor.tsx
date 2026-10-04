"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { objectiveLabel, useObjectives } from "@/lib/objectives";
import { TYPE_LABEL, type EditorQuestion, type QType } from "@/lib/quiz";

const LETTERS = "abcdefghijkl";
const idFor = (i: number) => LETTERS[i] ?? `o${i}`;
interface Choice {
  text: string;
  correct: boolean;
}

function initialChoices(q?: EditorQuestion): Choice[] {
  if (q && (q.type === "mcq" || q.type === "multi")) {
    const right: string[] = q.type === "mcq" ? [q.key.correct] : q.key.correct;
    return q.payload.options.map((o: { id: string; text: string }) => ({ text: o.text, correct: right.includes(o.id) }));
  }
  return [0, 1, 2, 3].map(() => ({ text: "", correct: false }));
}

export function QuestionEditor({ itemId, archiveId, initial, onSaved, onCancel }: { itemId: string; archiveId: string; initial?: EditorQuestion; onSaved: () => void; onCancel: () => void }) {
  const { api } = useAuth();
  const { tree: objectives } = useObjectives(archiveId);
  const [type, setType] = useState<QType>(initial?.type ?? "mcq");
  const [choices, setChoices] = useState<Choice[]>(() => initialChoices(initial));
  const [blanks, setBlanks] = useState<string[]>(() => (initial?.type === "fib" ? initial.key.blanks.map((b: any) => (b.accepted ?? []).join(" | ")) : [""]));
  const [items, setItems] = useState<{ text: string; target: number }[]>(() =>
    initial?.type === "dnd"
      ? initial.payload.items.map((i: any) => ({ text: i.text, target: initial.payload.targets.findIndex((t: any) => t.id === initial.key.mapping[i.id]) }))
      : [{ text: "", target: 0 }, { text: "", target: 0 }],
  );
  const [targets, setTargets] = useState<string[]>(() => (initial?.type === "dnd" ? initial.payload.targets.map((t: any) => t.text) : ["", ""]));
  const [scenario, setScenario] = useState(() => (initial?.type === "pbq" ? JSON.stringify(initial.payload, null, 2) : '{\n  "title": "",\n  "instructions": "",\n  "scenario": { "fields": [] }\n}'));
  const [assertions, setAssertions] = useState(() => (initial?.type === "pbq" ? JSON.stringify(initial.key.assertions, null, 2) : '[\n  { "id": "a1", "label": "", "path": "", "op": "eq", "value": "", "weight": 1 }\n]'));
  const [error, setError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function body(f: FormData): Record<string, unknown> {
    const meta = {
      stem: String(f.get("stem")),
      explanation: String(f.get("explanation") ?? ""),
      domain: String(f.get("domain") ?? "").trim() || null,
      objectiveId: String(f.get("objective") ?? "") || null,
      weight: Number(f.get("weight") || 1),
      difficulty: f.get("difficulty") ? Number(f.get("difficulty")) : null,
      isPretest: f.get("isPretest") === "on",
    };
    if (type === "mcq" || type === "multi") {
      const options = choices.map((c, i) => ({ id: idFor(i), text: c.text }));
      const correct = choices.flatMap((c, i) => (c.correct ? [idFor(i)] : []));
      return { ...meta, type, payload: { options }, key: type === "mcq" ? { correct: correct[0] ?? "" } : { correct } };
    }
    if (type === "fib") return { ...meta, type, payload: { blanks: blanks.length }, key: { blanks: blanks.map((b) => ({ accepted: b.split("|").map((x) => x.trim()).filter(Boolean) })) } };
    if (type === "dnd") {
      return {
        ...meta,
        type,
        payload: { items: items.map((it, i) => ({ id: `i${i}`, text: it.text })), targets: targets.map((t, i) => ({ id: `t${i}`, text: t })) },
        key: { mapping: Object.fromEntries(items.map((it, i) => [`i${i}`, `t${it.target}`])) },
      };
    }
    return { ...meta, type, payload: JSON.parse(scenario), key: { assertions: JSON.parse(assertions) } };
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError([]);
    let b: Record<string, unknown>;
    try {
      b = body(new FormData(e.currentTarget));
    } catch {
      return setError(["The scenario or assertions are not valid JSON."]);
    }
    if (type === "mcq" || type === "multi") {
      const n = choices.filter((c) => c.correct).length;
      if (n === 0) return setError(["Mark the correct answer."]);
      if (type === "multi" && n === choices.length) return setError(["At least one option must be wrong."]);
    }
    setBusy(true);
    try {
      if (initial) await api("PATCH", `questions/${initial.id}`, b);
      else await api("POST", `quizzes/${itemId}/questions`, b);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues.length ? err.issues : [err.code.replaceAll("_", " ")]) : ["Something went wrong."]);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-ink";
  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-line p-4">
      <div className="space-y-1">
        <label htmlFor="qe-type" className="text-sm text-muted">
          Question type
        </label>
        <select id="qe-type" value={type} onChange={(e) => setType(e.target.value as QType)} className={input}>
          {(Object.keys(TYPE_LABEL) as QType[]).map((k) => (
            <option key={k} value={k}>
              {TYPE_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="qe-stem" className="text-sm text-muted">
          Question (Markdown allowed)
        </label>
        <textarea id="qe-stem" name="stem" required defaultValue={initial?.stem} rows={3} maxLength={10000} className={input} />
      </div>

      {(type === "mcq" || type === "multi") && (
        <fieldset className="space-y-2">
          <legend className="text-sm text-muted">{type === "mcq" ? "Options (pick the one correct answer)" : "Options (tick every correct answer)"}</legend>
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type={type === "mcq" ? "radio" : "checkbox"}
                name="correct"
                aria-label={`Option ${i + 1} is correct`}
                checked={c.correct}
                onChange={(e) => setChoices(choices.map((x, j) => (type === "mcq" ? { ...x, correct: j === i } : j === i ? { ...x, correct: e.target.checked } : x)))}
              />
              <input aria-label={`Option ${i + 1} text`} value={c.text} required onChange={(e) => setChoices(choices.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className={input} />
              {choices.length > 2 && (
                <Button type="button" variant="quiet" aria-label={`Remove option ${i + 1}`} onClick={() => setChoices(choices.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          ))}
          {choices.length < 12 && (
            <Button type="button" variant="quiet" onClick={() => setChoices([...choices, { text: "", correct: false }])}>
              <Plus size={14} /> Add option
            </Button>
          )}
        </fieldset>
      )}

      {type === "fib" && (
        <fieldset className="space-y-2">
          <legend className="text-sm text-muted">Accepted answers for each blank, separated by | (case and spacing are ignored)</legend>
          {blanks.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label={`Blank ${i + 1} accepted answers`} value={b} required onChange={(e) => setBlanks(blanks.map((x, j) => (j === i ? e.target.value : x)))} className={input} />
              {blanks.length > 1 && (
                <Button type="button" variant="quiet" aria-label={`Remove blank ${i + 1}`} onClick={() => setBlanks(blanks.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </Button>
              )}
            </div>
          ))}
          {blanks.length < 20 && (
            <Button type="button" variant="quiet" onClick={() => setBlanks([...blanks, ""])}>
              <Plus size={14} /> Add blank
            </Button>
          )}
        </fieldset>
      )}

      {type === "dnd" && (
        <div className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-sm text-muted">Targets (the places items can go)</legend>
            {targets.map((t, i) => (
              <input key={i} aria-label={`Target ${i + 1}`} value={t} required onChange={(e) => setTargets(targets.map((x, j) => (j === i ? e.target.value : x)))} className={input} />
            ))}
            <Button type="button" variant="quiet" onClick={() => setTargets([...targets, ""])}>
              <Plus size={14} /> Add target
            </Button>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm text-muted">Items and where each belongs</legend>
            {items.map((it, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-2">
                <input aria-label={`Item ${i + 1}`} value={it.text} required onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className={input} />
                <select aria-label={`Item ${i + 1} belongs in`} value={it.target} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)))} className={input}>
                  {targets.map((t, k) => (
                    <option key={k} value={k}>
                      {t || `Target ${k + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <Button type="button" variant="quiet" onClick={() => setItems([...items, { text: "", target: 0 }])}>
              <Plus size={14} /> Add item
            </Button>
          </fieldset>
        </div>
      )}

      {type === "pbq" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="qe-scn" className="text-sm text-muted">
              Scenario (JSON: title, instructions, and scenario.fields with path, label, kind text, number, select or checkbox)
            </label>
            <textarea id="qe-scn" value={scenario} onChange={(e) => setScenario(e.target.value)} rows={7} spellCheck={false} className={`${input} font-mono text-sm`} />
          </div>
          <div className="space-y-1">
            <label htmlFor="qe-ass" className="text-sm text-muted">
              Checks on the final state (JSON list: id, label, path, op eq, neq, in, contains, gte, lte or matches, value, weight)
            </label>
            <textarea id="qe-ass" value={assertions} onChange={(e) => setAssertions(e.target.value)} rows={7} spellCheck={false} className={`${input} font-mono text-sm`} />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label htmlFor="qe-exp" className="text-sm text-muted">
          Explanation (shown after answering)
        </label>
        <textarea id="qe-exp" name="explanation" defaultValue={initial?.explanation} rows={2} maxLength={10000} className={input} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="qe-domain" name="domain" label="Domain (optional)" defaultValue={initial?.domain ?? ""} maxLength={100} />
        <Field id="qe-weight" name="weight" label="Weight (marks)" type="number" min={1} max={100} defaultValue={initial?.weight ?? 1} />
        <Field id="qe-diff" name="difficulty" label="Difficulty 1 to 5" type="number" min={1} max={5} defaultValue={initial?.difficulty ?? ""} />
      </div>
      {objectives && objectives.length > 0 && (
        <div className="space-y-1">
          <label htmlFor="qe-objective" className="text-sm text-muted">
            Exam objective (optional)
          </label>
          <select id="qe-objective" name="objective" defaultValue={initial?.objectiveId ?? ""} className={input}>
            <option value="">Not linked</option>
            {objectives.map((d) => (
              <optgroup key={d.id} label={objectiveLabel(d)}>
                {(d.children?.length ? d.children : [d]).map((o) => (
                  <option key={o.id} value={o.id}>
                    {objectiveLabel(o)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPretest" defaultChecked={initial?.isPretest} /> Unscored trial question (collects data without counting)
      </label>
      {error.length > 0 && (
        <ul role="alert" className="text-sm text-danger">
          {error.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {initial ? "Save question" : "Add question"}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
