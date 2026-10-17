"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Loading } from "@/components/loading";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { glossaryCards, parseGlossary, type GlossaryTerm } from "@/lib/glossary";
import { useNaming } from "@/lib/naming";

const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-ink";

/** The terms and acronyms of a course. Everyone who can read the course can search it; editors add, paste in bulk and publish drafts. */
export function GlossaryPanel({ archiveId, canEdit }: { archiveId: string; canEdit: boolean }) {
  const { api } = useAuth();
  const { t } = useNaming();
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ term: "", expansion: "", definition: "" });
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTerms((await api<{ terms: GlossaryTerm[] }>("GET", `archives/${archiveId}/glossary`)).terms);
    } catch {
      setTerms([]);
      setError("Could not load the glossary.");
    }
  }, [api, archiveId]);
  useEffect(() => void load(), [load]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (terms ?? []).filter((x) => !n || `${x.term} ${x.expansion} ${x.definition}`.toLowerCase().includes(n));
  }, [terms, q]);
  const drafts = (terms ?? []).filter((x) => x.status === "draft").length;

  async function put(list: { term: string; expansion?: string; definition: string }[]) {
    setBusy(true);
    setError(null);
    setMsg("");
    try {
      const r = await api<{ added: number; updated: number }>("PUT", `archives/${archiveId}/glossary`, { terms: list });
      setMsg(`${r.added} added, ${r.updated} updated.`);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError && err.status === 400 ? "That did not fit: a glossary holds up to 2,000 terms, and each needs a term and a definition." : "Could not save. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addOne(e: FormEvent) {
    e.preventDefault();
    if (await put([form])) {
      setForm({ term: "", expansion: "", definition: "" });
      setAdding(false);
    }
  }

  async function addPasted() {
    const { terms: list, skipped } = parseGlossary(paste);
    if (!list.length) return setError("No terms found. Use one per line, like: AES (Advanced Encryption Standard): a symmetric cipher");
    for (let i = 0; i < list.length; i += 500) if (!(await put(list.slice(i, i + 500)))) return;
    setPaste("");
    if (skipped.length) setMsg((m) => `${m} Skipped ${skipped.length} line${skipped.length === 1 ? "" : "s"} that were not "term: definition".`);
  }

  async function remove(x: GlossaryTerm) {
    try {
      await api("DELETE", `archives/${archiveId}/glossary/${x.id}`);
      setTerms((l) => (l ? l.filter((y) => y.id !== x.id) : l));
    } catch {
      setError("Could not delete that term.");
    }
  }

  async function publish() {
    try {
      await api("POST", `archives/${archiveId}/glossary/publish`);
      await load();
    } catch {
      setError("Could not publish.");
    }
  }

  async function makeDeck() {
    setBusy(true);
    setMsg("");
    try {
      const cards = glossaryCards((terms ?? []).filter((x) => x.status === "published"));
      await api("POST", `archives/${archiveId}/items`, { kind: "deck", title: "Glossary flashcards", summary: "Every glossary term as a flashcard.", cards: cards.slice(0, 500), source: "human" });
      setMsg(`Made a deck of ${Math.min(cards.length, 500)} flashcards. Find it under Material.`);
    } catch {
      setError("Could not make the deck.");
    } finally {
      setBusy(false);
    }
  }

  if (!terms) return <Loading />;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl">{t("glossary")}</h2>
        <p className="text-sm text-muted">Terms and acronyms this exam expects you to know.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="gl-search">
          Search the glossary
        </label>
        <input id="gl-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search terms and definitions" className={`${input} max-w-sm`} />
        {canEdit && (
          <Button variant="quiet" onClick={() => setAdding((v) => !v)}>
            {adding ? "Close" : "Add terms"}
          </Button>
        )}
        {canEdit && terms.some((x) => x.status === "published") && (
          <Button variant="quiet" onClick={makeDeck} disabled={busy}>
            Make a flashcard deck
          </Button>
        )}
        {canEdit && drafts > 0 && <Button onClick={publish}>Publish {drafts} draft{drafts === 1 ? "" : "s"}</Button>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {msg && (
        <p role="status" className="text-sm text-muted">
          {msg}
        </p>
      )}
      {canEdit && adding && (
        <div className="space-y-4 rounded-md border border-line p-4">
          <form onSubmit={addOne} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-muted">
              Term
              <input required maxLength={100} value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} className={`mt-1 ${input}`} />
            </label>
            <label className="text-sm text-muted">
              Stands for (optional)
              <input maxLength={200} value={form.expansion} onChange={(e) => setForm({ ...form, expansion: e.target.value })} className={`mt-1 ${input}`} />
            </label>
            <label className="text-sm text-muted sm:col-span-2">
              Definition
              <textarea required maxLength={2000} rows={2} value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} className={`mt-1 ${input}`} />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Save term
              </Button>
            </div>
          </form>
          <div className="space-y-2 border-t border-line pt-4">
            <label className="block text-sm text-muted" htmlFor="gl-paste">
              Or paste many, one per line: <code>AES (Advanced Encryption Standard): a symmetric cipher</code>
            </label>
            <textarea id="gl-paste" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} className={`${input} font-mono text-sm`} />
            <Button variant="quiet" onClick={addPasted} disabled={busy || !paste.trim()}>
              Add pasted terms
            </Button>
          </div>
        </div>
      )}
      {terms.length === 0 ? (
        <p className="text-muted">{canEdit ? "No terms yet. Add the acronyms and key terms the exam uses." : "No terms have been added to this course yet."}</p>
      ) : shown.length === 0 ? (
        <p className="text-muted">Nothing matches that.</p>
      ) : (
        <dl className="divide-y divide-line">
          {shown.map((x) => (
            <div key={x.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <dt className="font-medium">
                  {x.term}
                  {x.expansion && <span className="ml-2 font-normal text-muted">{x.expansion}</span>}
                  {x.status === "draft" && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs font-normal text-muted">draft</span>}
                </dt>
                <dd className="mt-1 text-sm">{x.definition}</dd>
              </div>
              {canEdit && (
                <button onClick={() => remove(x)} aria-label={`Delete ${x.term}`} className="shrink-0 text-muted hover:text-danger">
                  <Trash2 size={16} aria-hidden />
                </button>
              )}
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
