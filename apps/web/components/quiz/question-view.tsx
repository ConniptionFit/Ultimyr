"use client";

import { Check, X } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { pathGet, pathSet, type Outcome, type PbqField, type PlayQuestion } from "@/lib/quiz";

type Fb = NonNullable<PlayQuestion["feedback"]>;

const outcomeText: Record<Outcome, string> = { correct: "Correct", partial: "Partly right", incorrect: "Not quite", unanswered: "Not answered", excluded: "Not scored" };

/** Render one question and collect an answer. Every control is a real form control so keyboards and screen readers work. */
export function QuestionView({ q, onChange, disabled }: { q: PlayQuestion; onChange: (r: unknown) => void; disabled: boolean }) {
  const r = q.response;
  const name = `q-${q.id}`;
  return (
    <fieldset disabled={disabled} className="space-y-4 border-0 p-0">
      <legend className="mb-3 text-lg">
        <Markdown>{q.stem}</Markdown>
      </legend>
      {q.type === "mcq" && (
        <div className="space-y-2" role="radiogroup">
          {q.payload.options.map((o: { id: string; text: string }) => (
            <label key={o.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-surface">
              <input type="radio" name={name} checked={r?.choice === o.id} onChange={() => onChange({ choice: o.id })} className="mt-1" />
              <span>{o.text}</span>
            </label>
          ))}
        </div>
      )}
      {q.type === "multi" && (
        <div className="space-y-2">
          {q.payload.select && <p className="text-sm text-muted">Select {q.payload.select}.</p>}
          {q.payload.options.map((o: { id: string; text: string }) => {
            const chosen: string[] = r?.choices ?? [];
            return (
              <label key={o.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-surface">
                <input
                  type="checkbox"
                  checked={chosen.includes(o.id)}
                  onChange={(e) => onChange({ choices: e.target.checked ? [...chosen, o.id] : chosen.filter((c) => c !== o.id) })}
                  className="mt-1"
                />
                <span>{o.text}</span>
              </label>
            );
          })}
        </div>
      )}
      {q.type === "fib" && (
        <div className="space-y-2">
          {Array.from({ length: q.payload.blanks }, (_, i) => (
            <label key={i} className="block text-sm text-muted">
              {q.payload.blanks > 1 ? `Blank ${i + 1}` : "Your answer"}
              <input
                value={r?.blanks?.[i] ?? ""}
                onChange={(e) => {
                  const blanks = [...(r?.blanks ?? Array(q.payload.blanks).fill(""))];
                  blanks[i] = e.target.value;
                  onChange({ blanks });
                }}
                maxLength={200}
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
              />
            </label>
          ))}
        </div>
      )}
      {q.type === "dnd" && (
        <div className="space-y-2">
          <p className="text-sm text-muted">Choose where each item belongs.</p>
          {q.payload.items.map((it: { id: string; text: string }) => (
            <label key={it.id} className="grid items-center gap-2 sm:grid-cols-2">
              <span>{it.text}</span>
              <select
                value={r?.mapping?.[it.id] ?? ""}
                onChange={(e) => {
                  const mapping = { ...(r?.mapping ?? {}) };
                  if (e.target.value) mapping[it.id] = e.target.value;
                  else delete mapping[it.id];
                  onChange({ mapping });
                }}
                className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
              >
                <option value="">Choose…</option>
                {q.payload.targets.map((t: { id: string; text: string }) => (
                  <option key={t.id} value={t.id}>
                    {t.text}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {q.type === "pbq" && <Scenario q={q} onChange={onChange} />}
    </fieldset>
  );
}

/** Scenario questions describe their form as `payload.scenario.fields`; the answer is the resulting state object. */
function Scenario({ q, onChange }: { q: PlayQuestion; onChange: (r: unknown) => void }) {
  const state = q.response?.state ?? {};
  const fields: PbqField[] = q.payload.scenario?.fields ?? [];
  return (
    <div className="space-y-3 rounded-md border border-line p-4">
      {q.payload.title && <h3 className="text-base font-medium">{q.payload.title}</h3>}
      {q.payload.instructions && <Markdown>{q.payload.instructions}</Markdown>}
      {fields.map((f) => {
        const id = `f-${q.id}-${f.path}`;
        const v = pathGet(state, f.path);
        const set = (value: unknown) => onChange({ state: pathSet(state, f.path, value) });
        return (
          <div key={f.path} className="space-y-1">
            {f.kind === "checkbox" ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked)} />
                {f.label}
              </label>
            ) : (
              <>
                <label htmlFor={id} className="text-sm text-muted">
                  {f.label}
                </label>
                {f.kind === "select" ? (
                  <select id={id} value={v ?? ""} onChange={(e) => set(e.target.value)} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                    <option value="">Choose…</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={id}
                    type={f.kind === "number" ? "number" : "text"}
                    value={v ?? ""}
                    onChange={(e) => set(f.kind === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
                    className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
                  />
                )}
              </>
            )}
          </div>
        );
      })}
      {fields.length === 0 && <p className="text-sm text-muted">This scenario has no form fields defined.</p>}
    </div>
  );
}

/** What the right answer was, in words, with the explanation. Shown after checking or submitting. */
export function FeedbackView({ q, fb }: { q: PlayQuestion; fb: Fb }) {
  const ok = fb.outcome === "correct";
  const opt = (id: string) => q.payload.options?.find((o: { id: string }) => o.id === id)?.text ?? id;
  return (
    <div className="mt-4 space-y-2 rounded-md border border-line p-4 text-sm" role="status">
      <p className="flex items-center gap-2 font-medium">
        {ok ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
        {outcomeText[fb.outcome]}
        {fb.outcome !== "unanswered" && fb.outcome !== "excluded" && <span className="font-normal text-muted">· {fb.earned >= 0 ? "" : "−"}{Math.abs(fb.earned) / 1000} of {fb.max / 1000}</span>}
      </p>
      <div className="text-muted">
        {q.type === "mcq" && <p>Answer: {opt(fb.key.correct)}</p>}
        {q.type === "multi" && <p>Answer: {fb.key.correct.map(opt).join("; ")}</p>}
        {q.type === "fib" && (
          <ul>
            {fb.key.blanks.map((b: any, i: number) => (
              <li key={i}>
                Blank {i + 1}: {[...(b.accepted ?? []), ...(b.numeric ? [`${b.numeric.value} (±${b.numeric.tolerance})`] : []), ...(b.regex ? [`matches ${b.regex}`] : [])].join(" or ")}
              </li>
            ))}
          </ul>
        )}
        {q.type === "dnd" && (
          <ul>
            {q.payload.items.map((i: { id: string; text: string }) => (
              <li key={i.id}>
                {i.text} → {q.payload.targets.find((t: { id: string }) => t.id === fb.key.mapping[i.id])?.text}
              </li>
            ))}
          </ul>
        )}
        {q.type === "pbq" && (
          <ul>
            {fb.key.assertions.map((a: any) => (
              <li key={a.id}>
                {fb.detail?.assertions?.[a.id] ? "✓" : "✗"} {a.label || `${a.path} ${a.op} ${JSON.stringify(a.value)}`}
              </li>
            ))}
          </ul>
        )}
      </div>
      {fb.explanation && <Markdown>{fb.explanation}</Markdown>}
    </div>
  );
}
