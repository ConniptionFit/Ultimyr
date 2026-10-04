"use client";

import { ArchiveIcon, StatusIcon } from "@ultimyr/ui-icons";
import { BookOpen, Download, FileQuestion, Layers, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Header } from "@/components/header";
import { GeneratePanel } from "@/components/generate-panel";
import { SharePanel } from "@/components/share-panel";
import { Button, Field, Shell } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { ICONS, iconFor } from "@/lib/icons";
import { useNaming } from "@/lib/naming";
import { canEdit, type Archive, type ItemSummary } from "@/lib/types";

const KIND_ICON = { guide: BookOpen, deck: Layers, quiz: FileQuestion } as const;

export default function ArchivePage() {
  const { id } = useParams<{ id: string }>();
  const { state, api } = useAuth();
  const { t } = useNaming();
  const router = useRouter();
  const [a, setA] = useState<Archive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ItemSummary["kind"] | null>(null);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    try {
      setA(await api<Archive>("GET", `archives/${id}`));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "This shelf is empty. We have no record of that page." : "Could not load.");
    }
  }, [api, id]);

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status === "authenticated") void load();
  }, [state.status, router, load]);

  async function addItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!adding) return;
    const title = String(new FormData(e.currentTarget).get("title")).trim();
    try {
      const it = await api<ItemSummary>("POST", `archives/${id}/items`, { kind: adding, title });
      router.push(`/items/${it.id}`);
    } catch {
      setError("Could not add that.");
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const links = String(f.get("link") ?? "").trim();
    try {
      await api("PATCH", `archives/${id}`, {
        title: String(f.get("title")).trim(),
        overview: String(f.get("overview")),
        vendor: String(f.get("vendor")).trim() || null,
        iconName: String(f.get("icon")),
        validityMonths: Number(f.get("validity")) || null,
        quickStats: {
          ...(String(f.get("passing")).trim() ? { passingScore: String(f.get("passing")).trim() } : {}),
          ...(Number(f.get("duration")) ? { durationMinutes: Number(f.get("duration")) } : {}),
          ...(Number(f.get("questions")) ? { questionCount: Number(f.get("questions")) } : {}),
          ...(Number(f.get("cost")) ? { costUsd: Number(f.get("cost")) } : {}),
          ...(f.get("difficulty") ? { difficulty: String(f.get("difficulty")) } : {}),
        },
        purchaseLinks: links ? [{ label: "Buy or schedule", url: links }] : [],
      });
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0] ?? err.code.replaceAll("_", " ")) : "Could not save.");
    }
  }

  async function uploadIcon(file: File) {
    setError(null);
    const res = await fetch(`/api/v1/archives/${id}/icon`, {
      method: "POST",
      headers: { "content-type": "image/png", authorization: `Bearer ${state.status === "authenticated" ? state.accessToken : ""}` },
      body: file,
    });
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: string }).error;
      setError(
        code === "icon_needs_transparency" ? "Icons must be PNGs with a transparent background." : code === "icon_bad_dimensions" ? "Icons must be between 16 and 1024 pixels." : code === "icon_too_large" ? "That file is over 512 KB." : "That is not a usable PNG.",
      );
      return;
    }
    await load();
  }

  async function download(path: string, name: string) {
    if (state.status !== "authenticated") return;
    const res = await fetch(`/api/v1/${path}`, { headers: { authorization: `Bearer ${state.accessToken}` } });
    if (!res.ok) return setError("Export failed.");
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (state.status !== "authenticated" || (!a && !error)) {
    return (
      <>
        <Header />
        <Shell>
          <StatusIcon status="loading" size={22} />
        </Shell>
      </>
    );
  }
  if (!a) {
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
  const editor = canEdit(a.relation);
  const stats = a.quickStats;

  return (
    <>
      <Header />
      <Shell>
        <div className="ulti-fade space-y-8">
          <div className="flex items-start gap-4">
            <span className="mt-1 text-accent">
              <ArchiveIcon pngUrl={a.icon.url} fallback={iconFor(a.icon.name)} size={44} alt="" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl">{a.title}</h1>
              <p className="text-sm text-muted">{[a.vendor, a.visibility !== "private" ? a.visibility : null, a.relation !== "owner" ? `you can ${a.relation === "editor" ? "edit" : "view"}` : null].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex gap-2">
              {editor && (
                <Button variant="quiet" onClick={() => setEditing(!editing)} aria-label="Edit details">
                  <Pencil size={16} />
                </Button>
              )}
              <Button variant="quiet" onClick={() => download(`archives/${id}/export`, `${a.slug}.ultimyr.json`)} aria-label="Export">
                <Download size={16} />
              </Button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {a.overview && <p className="max-w-prose whitespace-pre-line text-ink/90">{a.overview}</p>}

          {(stats.passingScore || stats.durationMinutes || stats.questionCount || stats.costUsd !== undefined || stats.difficulty || a.validityMonths) && (
            <dl className="grid grid-cols-2 gap-3 rounded-md border border-line p-4 text-sm sm:grid-cols-3">
              {stats.passingScore && <Stat k="Passing score" v={stats.passingScore} />}
              {stats.durationMinutes && <Stat k="Duration" v={`${stats.durationMinutes} min`} />}
              {stats.questionCount && <Stat k="Questions" v={String(stats.questionCount)} />}
              {stats.costUsd !== undefined && <Stat k="Cost" v={`$${stats.costUsd}`} />}
              {stats.difficulty && <Stat k="Difficulty" v={stats.difficulty} />}
              {a.validityMonths && <Stat k="Valid for" v={`${a.validityMonths} months`} />}
            </dl>
          )}
          {a.purchaseLinks.length > 0 && (
            <p className="text-sm">
              {a.purchaseLinks.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="mr-4 text-accent underline">
                  {l.label}
                </a>
              ))}
            </p>
          )}

          {editing && (
            <form onSubmit={save} className="space-y-3 rounded-md border border-line p-4">
              <Field id="e-title" name="title" label="Name" defaultValue={a.title} required maxLength={120} />
              <Field id="e-vendor" name="vendor" label="Vendor" defaultValue={a.vendor ?? ""} maxLength={120} />
              <div className="space-y-1">
                <label htmlFor="e-overview" className="text-sm text-muted">
                  Overview
                </label>
                <textarea id="e-overview" name="overview" defaultValue={a.overview} rows={4} maxLength={10000} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="e-passing" name="passing" label="Passing score" defaultValue={stats.passingScore ?? ""} />
                <Field id="e-duration" name="duration" type="number" min={1} label="Minutes" defaultValue={stats.durationMinutes ?? ""} />
                <Field id="e-questions" name="questions" type="number" min={1} label="Questions" defaultValue={stats.questionCount ?? ""} />
                <Field id="e-cost" name="cost" type="number" min={0} step="0.01" label="Cost (USD)" defaultValue={stats.costUsd ?? ""} />
                <Field id="e-validity" name="validity" type="number" min={1} label="Valid for (months)" defaultValue={a.validityMonths ?? ""} />
                <div className="space-y-1">
                  <label htmlFor="e-difficulty" className="text-sm text-muted">
                    Difficulty
                  </label>
                  <select id="e-difficulty" name="difficulty" defaultValue={stats.difficulty ?? ""} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                    <option value="">Not set</option>
                    {["beginner", "intermediate", "advanced", "expert"].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
              <Field id="e-link" name="link" type="url" label="Purchase or scheduling link" defaultValue={a.purchaseLinks[0]?.url ?? ""} />
              <fieldset className="space-y-2">
                <legend className="text-sm text-muted">Icon</legend>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(ICONS).map(([name, Icon]) => (
                    <label key={name} className="cursor-pointer rounded-md border border-line p-2 has-[:checked]:border-accent has-[:checked]:text-accent">
                      <input type="radio" name="icon" value={name} defaultChecked={a.icon.kind === "lucide" && a.icon.name === name} className="sr-only" />
                      <Icon size={20} aria-label={name} />
                    </label>
                  ))}
                </div>
                <label className="block text-sm text-muted">
                  Or upload a PNG with a transparent background (16 to 1024 px, up to 512 KB)
                  <input type="file" accept="image/png" className="mt-1 block text-ink" onChange={(e) => e.target.files?.[0] && uploadIcon(e.target.files[0])} />
                </label>
              </fieldset>
              <div className="flex gap-2">
                <Button type="submit">Save</Button>
                <Button type="button" variant="quiet" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                {a.relation === "owner" && (
                  <Button
                    type="button"
                    variant="quiet"
                    className="ml-auto text-danger"
                    onClick={async () => {
                      if (!confirm("Strike this from the Archives? You can recover it for 30 days.")) return;
                      await api("DELETE", `archives/${id}`);
                      router.push("/reading-room");
                    }}
                  >
                    <Trash2 size={16} /> Delete
                  </Button>
                )}
              </div>
            </form>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xl">Material</h2>
              {editor && !adding && (
                <div className="flex gap-2">
                  <Button variant="quiet" onClick={() => setAdding("guide")}>
                    + {t("guide")}
                  </Button>
                  <Button variant="quiet" onClick={() => setAdding("deck")}>
                    + {t("deck")}
                  </Button>
                  <Button variant="quiet" onClick={() => setAdding("quiz")}>
                    + {t("quiz")}
                  </Button>
                </div>
              )}
            </div>
            {adding && (
              <form onSubmit={addItem} className="flex items-end gap-2">
                <div className="flex-1">
                  <Field id="item-title" name="title" label={`${t(adding)} title`} required maxLength={160} autoFocus />
                </div>
                <Button type="submit">Add</Button>
                <Button type="button" variant="quiet" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
              </form>
            )}
            <ul className="divide-y divide-line rounded-md border border-line">
              {(a.items ?? []).length === 0 && <li className="p-4 text-muted">Nothing shelved yet. Begin with a single page.</li>}
              {(a.items ?? []).map((it) => {
                const Icon = KIND_ICON[it.kind];
                return (
                  <li key={it.id}>
                    <Link href={`/items/${it.id}`} className="flex items-center gap-3 p-3 hover:bg-surface">
                      <Icon size={18} className="text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{it.title}</span>
                        {it.summary && <span className="block truncate text-sm text-muted">{it.summary}</span>}
                      </span>
                      {it.status === "draft" && <span className="rounded-full border border-line px-2 text-xs text-muted">draft{it.aiStatus === "draft" ? " (AI)" : ""}</span>}
                      <span className="text-xs text-muted">{t(it.kind)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {editor && <GeneratePanel archiveId={id} onDone={() => void load()} />}

          {a.relation === "owner" && (
            <div>
              <Button variant="quiet" onClick={() => setSharing(!sharing)}>
                {t("share")}…
              </Button>
              {sharing && (
                <div className="mt-3">
                  <SharePanel base={`archives/${id}`} />
                </div>
              )}
            </div>
          )}
        </div>
      </Shell>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className="capitalize">{v}</dd>
    </div>
  );
}
