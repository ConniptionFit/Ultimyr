"use client";

import { Download, History, Pencil, Printer, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AssistantPanel } from "@/components/assistant-panel";
import { Loading } from "@/components/loading";
import { Header } from "@/components/header";
import { Markdown } from "@/components/markdown";
import { ObjectivePicker } from "@/components/coverage/objective-picker";
import { QuizPanel } from "@/components/quiz/quiz-panel";
import { readingMinutes } from "@/lib/reading-time";
import { GuideReader, Study } from "@/components/item-views";
import { SharePanel } from "@/components/share-panel";
import { Button, Field, Shell, TextAreaField } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { usePageTitle } from "@/lib/page-title";
import { canEdit, type Card, type ItemDetail } from "@/lib/types";

interface Version {
  number: number;
  source: string;
  note: string | null;
  createdAt: string;
  current: boolean;
}

export default function ItemPage() {
  const { id } = useParams<{ id: string }>();
  const { state, api } = useAuth();
  const { t, copy } = useNaming();
  const router = useRouter();
  const [it, setIt] = useState<ItemDetail | null>(null);
  usePageTitle(it?.title);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [studying, setStudying] = useState(false);

  const load = useCallback(async () => {
    try {
      setIt(await api<ItemDetail>("GET", `items/${id}`));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "This shelf is empty. We have no record of that page." : "Could not load.");
    }
  }, [api, id]);

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status === "authenticated") void load();
  }, [state.status, router, load]);

  const fail = (e: unknown) => setError(e instanceof ApiError ? (e.issues[0] ?? e.code.replaceAll("_", " ")) : "Something went wrong.");

  async function saveGuide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api("PATCH", `items/${id}`, { title: String(f.get("title")).trim(), summary: String(f.get("summary")), markdown: String(f.get("markdown")), note: String(f.get("note") ?? "") || undefined });
      setEditing(false);
      setVersions(null);
      await load();
    } catch (err) {
      fail(err);
    }
  }

  async function download(format: string, name: string) {
    if (state.status !== "authenticated") return;
    const res = await fetch(`/api/v1/items/${id}/export?format=${format}`, { headers: { authorization: `Bearer ${state.accessToken}` } });
    if (!res.ok) return setError("Export failed.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (state.status !== "authenticated" || (!it && !error)) {
    return (
      <>
        <Header />
        <Shell>
          <Loading />
        </Shell>
      </>
    );
  }
  if (!it) {
    return (
      <>
        <Header />
        <Shell>
          <p role="alert">{error}</p>
          <Link href="/reading-room" className="text-accent underline">
            Back to {t("dashboard")}
          </Link>
        </Shell>
      </>
    );
  }
  const editor = canEdit(it.relation);

  return (
    <>
      <Header />
      <Shell>
        <div className="ulti-fade space-y-6">
          <Link href={`/archives/${it.archive.id}`} className="no-print text-sm text-muted hover:text-ink">
            ← {it.archive.title}
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl">{it.title}</h1>
              <p className="text-sm text-muted">
                {t(it.kind)}
                {it.status === "draft" ? " · draft, only editors can see it" : ""}
                {it.aiStatus === "draft" ? " · written by AI, review before publishing" : it.aiStatus === "reviewed" ? " · AI assisted, reviewed" : ""}
                {it.version ? ` · version ${it.version.number}` : ""}
              </p>
            </div>
            <div className="no-print flex shrink-0 gap-2">
              {it.kind !== "quiz" && (
                <Button variant="quiet" aria-label="Print or save as PDF" title="Print or save as PDF" onClick={() => window.print()}>
                  <Printer size={16} />
                </Button>
              )}
              {it.kind !== "quiz" && (
                <Button variant="quiet" aria-label="Export" onClick={() => (it.kind === "guide" ? download("markdown", "guide.md") : download("anki-csv", "deck.csv"))}>
                  <Download size={16} />
                </Button>
              )}
              {editor && it.kind === "guide" && (
                <Button variant="quiet" aria-label="Edit" onClick={() => setEditing(!editing)}>
                  <Pencil size={16} />
                </Button>
              )}
              {it.kind !== "quiz" && (
                <Button
                  variant="quiet"
                  aria-label="History"
                  onClick={async () => setVersions(versions ? null : await api<Version[]>("GET", `items/${id}/versions`).catch(() => []))}
                >
                  <History size={16} />
                </Button>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {it.status === "draft" && editor && (
            <div className="flex items-center justify-between gap-3 rounded-md border border-line p-3 text-sm">
              <span>This is a draft. Publish it when you are happy with it.</span>
              <Button
                onClick={async () => {
                  await api("PATCH", `items/${id}`, { status: "published" }).catch(fail);
                  await load();
                }}
              >
                Publish
              </Button>
            </div>
          )}

          {versions && (
            <ul className="divide-y divide-line rounded-md border border-line text-sm">
              {versions.map((v) => (
                <li key={v.number} className="flex items-center justify-between gap-3 p-3">
                  <span>
                    Version {v.number} · {v.source} · {new Date(v.createdAt).toLocaleString()}
                    {v.note ? ` · ${v.note}` : ""}
                    {v.current ? " (current)" : ""}
                  </span>
                  {editor && !v.current && (
                    <Button
                      variant="quiet"
                      onClick={async () => {
                        await api("POST", `items/${id}/versions/${v.number}/restore`).catch(fail);
                        setVersions(null);
                        await load();
                      }}
                    >
                      Restore
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {it.kind === "guide" && (editing ? <GuideEditor it={it} onSubmit={saveGuide} onCancel={() => setEditing(false)} /> : <GuideReader it={it} />)}
          {editor && it.kind !== "quiz" && (
            <div className="no-print">
              <ObjectivePicker archiveId={it.archive.id} kind="item" refId={id} />
            </div>
          )}
          {it.kind === "deck" && <Deck it={it} editor={editor} studying={studying} setStudying={setStudying} reload={load} fail={fail} />}
          {it.kind === "quiz" && <QuizPanel itemId={id} archiveId={it.archive.id} editor={editor} published={it.status === "published"} />}

          {it.kind !== "quiz" && it.status === "published" && (
            <div className="no-print">
              <AssistantPanel context={{ type: "item", id }} label="Ask about this" />
            </div>
          )}

          {editor && (
            <div className="no-print flex flex-wrap items-start gap-3 border-t border-line pt-4">
              {it.relation === "owner" && <ShareToggle id={id} />}
              <Button
                variant="quiet"
                className="text-danger"
                onClick={async () => {
                  if (!confirm(copy("deleteConfirm"))) return;
                  await api("DELETE", `items/${id}`).catch(fail);
                  router.push(`/archives/${it.archive.id}`);
                }}
              >
                <Trash2 size={16} /> Delete
              </Button>
            </div>
          )}
        </div>
      </Shell>
    </>
  );
}

function ShareToggle({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useNaming();
  return (
    <div className="w-full">
      <Button variant="quiet" onClick={() => setOpen(!open)}>
        {t("share")}…
      </Button>
      {open && (
        <div className="mt-3">
          <SharePanel base={`items/${id}`} />
        </div>
      )}
    </div>
  );
}

function GuideEditor({ it, onSubmit, onCancel }: { it: ItemDetail; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const [text, setText] = useState(it.markdown ?? "");
  const [preview, setPreview] = useState(false);
  const changed = text !== (it.markdown ?? "");

  // Closing the tab with unsaved edits asks first. Saving reloads the item, which unmounts this editor and removes the guard.
  useEffect(() => {
    if (!changed) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [changed]);

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field id="g-title" name="title" label="Title" defaultValue={it.title} required maxLength={160} />
      <Field id="g-summary" name="summary" label="Summary" defaultValue={it.summary} maxLength={2000} />
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="g-md" className="text-sm text-muted">
          Markdown (headings split the guide into sections)
        </label>
        <button type="button" className="shrink-0 text-sm text-accent underline" onClick={() => setPreview(!preview)}>
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="min-h-[20rem] rounded-md border border-line p-4">
          <Markdown>{text}</Markdown>
        </div>
      ) : (
        <textarea id="g-md" name="markdown" value={text} onChange={(e) => setText(e.target.value)} rows={22} spellCheck className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink" />
      )}
      {preview && <input type="hidden" name="markdown" value={text} />}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          {text.trim() ? `${text.trim().split(/\s+/).length} words, about ${readingMinutes(text)} min read` : "Nothing written yet"}
          {changed ? " · unsaved changes" : ""}
        </span>
        <label className="block">
          <span className="sr-only">Replace the text with a Markdown file</span>
          <input
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="max-w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-bg"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (text.trim() && !window.confirm("Replace the text above with this file?")) {
                e.target.value = "";
                return;
              }
              setText(await f.text());
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <Field id="g-note" name="note" label="What changed? (optional)" maxLength={200} />
      <div className="flex gap-2">
        <Button type="submit">Save new version</Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Deck({ it, editor, studying, setStudying, reload, fail }: { it: ItemDetail; editor: boolean; studying: boolean; setStudying: (v: boolean) => void; reload: () => Promise<void>; fail: (e: unknown) => void }) {
  const { api } = useAuth();
  const { t } = useNaming();
  const cards = it.cards ?? [];
  const [mine, setMine] = useState<{ learning: number; review: number; dueNow: number } | null>(null);
  useEffect(() => {
    api<{ learning: number; review: number; dueNow: number }>("GET", `study/stats?deck=${it.id}`).then(setMine).catch(() => setMine(null));
  }, [api, it.id]);
  const [editId, setEditId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Big decks render a page of cards at a time. Printing shows them all.
  const PAGE = 100;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const all = () => setLimit(Infinity);
    window.addEventListener("beforeprint", all);
    return () => window.removeEventListener("beforeprint", all);
  }, []);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api("POST", `items/${it.id}/cards`, { cards: [{ front: String(f.get("front")), back: String(f.get("back")) }] });
      form.reset();
      await reload();
    } catch (err) {
      fail(err);
    }
  }

  async function saveCard(c: Card, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api("PATCH", `cards/${c.id}`, { front: String(f.get("front")), back: String(f.get("back")) }).catch(fail);
    setEditId(null);
    await reload();
  }

  async function importCsv(file: File) {
    const content = await file.text();
    try {
      await api("POST", "import", { format: "anki-csv", archiveId: it.archive.id, title: `${it.title} (imported)`, content });
      await reload();
    } catch (err) {
      fail(err);
    }
  }

  const needle = filter.trim().toLowerCase();
  const shownCards = needle ? cards.filter((c) => `${c.front}\n${c.back}`.toLowerCase().includes(needle)) : cards;
  if (studying && cards.length) return <Study cards={cards} onDone={() => setStudying(false)} />;
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl">{cards.length} {cards.length === 1 ? t("card").toLowerCase() : `${t("card").toLowerCase()}s`}</h2>
        {cards.length > 0 && (
          <Button className="no-print" onClick={() => setStudying(true)}>
            Study
          </Button>
        )}
      </div>
      {mine && cards.length > 0 && (
        <p className="no-print text-sm text-muted">
          {Math.min(cards.length, mine.learning + mine.review)} of {cards.length} {cards.length === 1 ? "card" : "cards"} in your daily review
          {mine.dueNow > 0 && (
            <>
              {" "}
              ·{" "}
              <Link href={`/study?deck=${it.id}`} className="text-accent underline">
                {mine.dueNow} due, review now
              </Link>
            </>
          )}
        </p>
      )}
      {cards.length > 8 && (
        <div className="no-print">
          <label className="sr-only" htmlFor="card-filter">
            Filter {t("card").toLowerCase()}s
          </label>
          <input id="card-filter" type="search" value={filter} onChange={(e) => (setFilter(e.target.value), setLimit(PAGE))} placeholder={`Filter ${cards.length} ${t("card").toLowerCase()}s`} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
        </div>
      )}
      <ul className="divide-y divide-line rounded-md border border-line">
        {cards.length === 0 && <li className="p-4 text-muted">No cards yet.</li>}
        {cards.length > 0 && shownCards.length === 0 && <li className="p-4 text-muted">No card matches “{filter}”.</li>}
        {shownCards.slice(0, limit).map((c) => (
          <li key={c.id} className="break-inside-avoid p-3">
            {editId === c.id ? (
              <form onSubmit={(e) => saveCard(c, e)} className="space-y-2">
                <TextAreaField id={`f-${c.id}`} name="front" label="Front" defaultValue={c.front} required maxLength={5000} />
                <TextAreaField id={`b-${c.id}`} name="back" label="Back" defaultValue={c.back} required maxLength={10000} rows={4} />
                <p className="text-xs text-muted">Markdown works. Ctrl or Cmd plus Enter saves.</p>
                <div className="flex gap-2">
                  <Button type="submit">Save</Button>
                  <Button type="button" variant="quiet" onClick={() => setEditId(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    <Markdown>{c.front}</Markdown>
                  </div>
                  <div className="text-sm text-muted">
                    <Markdown>{c.back}</Markdown>
                  </div>
                </div>
                {editor && (
                  <div className="no-print flex shrink-0 gap-1">
                    <Button variant="quiet" aria-label="Edit card" onClick={() => setEditId(c.id)}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="quiet"
                      aria-label="Delete card"
                      onClick={async () => {
                        await api("POST", `items/${it.id}/cards/delete`, { ids: [c.id] }).catch(fail);
                        await reload();
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {shownCards.length > limit && (
        <p className="no-print">
          <Button variant="quiet" onClick={() => setLimit(limit + PAGE)}>
            Show {Math.min(PAGE, shownCards.length - limit)} more ({shownCards.length - limit} not shown)
          </Button>
        </p>
      )}
      {editor && (
        <div className="no-print space-y-4">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <TextAreaField id="new-front" name="front" label="Front" required maxLength={5000} />
            <TextAreaField id="new-back" name="back" label="Back" required maxLength={10000} />
            <Button type="submit">Add</Button>
            <p className="text-xs text-muted sm:col-span-3">Markdown works, and a back can run over several lines. Ctrl or Cmd plus Enter adds the card.</p>
          </form>
          <label className="block text-sm text-muted">
            Import cards from CSV (front, back, tags). Creates a new deck.
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="mt-1 block max-w-full text-sm text-muted file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-bg" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </label>
        </div>
      )}
    </section>
  );
}
