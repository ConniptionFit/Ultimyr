"use client";

import { ArchiveIcon } from "@ultimyr/ui-icons";
import { BookOpen, ChevronDown, ChevronRight, Download, FileQuestion, Layers, Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { DueLink } from "@/components/due-link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Loading } from "@/components/loading";
import { Header } from "@/components/header";
import { CoveragePanel } from "@/components/coverage/coverage-panel";
import { GeneratePanel } from "@/components/generate-panel";
import { SharePanel } from "@/components/share-panel";
import { ResourcesPanel } from "@/components/roadmap/resources-panel";
import { RoadmapPanel } from "@/components/roadmap/roadmap-panel";
import { Button, Field, Shell } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { ArchiveEditForm } from "@/components/archive-edit-form";
import { iconFor } from "@/lib/icons";
import { useNaming } from "@/lib/naming";
import { canEdit, type Archive, type ItemSummary } from "@/lib/types";

// The build panel carries the whole course-builder library (25 KB gzip) and only editors open it, so it loads on demand.
const BuildPanel = dynamic(() => import("@/components/build/build-panel").then((m) => m.BuildPanel), { loading: () => <Loading /> });

const KIND_ICON = { guide: BookOpen, deck: Layers, quiz: FileQuestion } as const;
const TABS = ["roadmap", "material", "resources", "coverage"] as const;
type Tab = (typeof TABS)[number];

export default function ArchivePage() {
  const { id } = useParams<{ id: string }>();
  const { state, api } = useAuth();
  const { t, copy } = useNaming();
  const router = useRouter();
  const [a, setA] = useState<Archive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<ItemSummary["kind"] | null>(null);
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [details, setDetails] = useState(false);
  const [tab, setTabState] = useState<Tab>("material");

  // The tab lives in the address (#roadmap) so a link can open straight onto it. With no tab named,
  // an archive that has a roadmap opens on it: the path is the front door, the material list is the shelf.
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (TABS.includes(h)) return setTabState(h);
    if (state.status !== "authenticated") return;
    void api<{ exists: boolean; stages: unknown[] }>("GET", `archives/${id}/roadmap`)
      .then((r) => r.exists && r.stages.length > 0 && setTabState("roadmap"))
      .catch(() => {});
  }, [api, id, state.status]);
  const setTab = (next: Tab) => {
    setTabState(next);
    history.replaceState(null, "", `#${next}`);
  };

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
          <Loading />
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

          {(() => {
            const bits = [stats.durationMinutes && `${stats.durationMinutes} min`, stats.questionCount && `${stats.questionCount} questions`, stats.passingScore && `pass ${stats.passingScore}`, stats.difficulty].filter(Boolean).join(" · ");
            const hasDetails = !!(a.overview || bits || a.validityMonths || stats.costUsd !== undefined || a.purchaseLinks.length);
            return hasDetails ? (
              <div className="space-y-4">
                <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className="flex w-full items-center gap-2 text-left text-sm text-muted hover:text-ink">
                  {details ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                  <span className="truncate">{details ? "Hide details" : bits ? `About this ${t("archive").toLowerCase()} · ${bits}` : `About this ${t("archive").toLowerCase()}`}</span>
                </button>
                {details && (
                  <>
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
                  </>
                )}
              </div>
            ) : null;
          })()}

          {editing && (
            <ArchiveEditForm
              archive={a}
              onSaved={async () => {
                setEditing(false);
                await load();
              }}
              onCancel={() => setEditing(false)}
              onError={setError}
              onChanged={load}
            />
          )}

          <DueLink archive={id} />

          <div role="tablist" aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-line">
            {TABS.map((k) => (
              <button
                key={k}
                role="tab"
                id={`tab-${k}`}
                aria-selected={tab === k}
                aria-controls={`panel-${k}`}
                onClick={() => setTab(k)}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${tab === k ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {k === "material" ? "Material" : k === "roadmap" ? t("roadmap") : k === "resources" ? t("resources") : t("coverage")}
              </button>
            ))}
          </div>

          {tab === "roadmap" && (
            <section id="panel-roadmap" role="tabpanel" aria-labelledby="tab-roadmap">
              <RoadmapPanel archiveId={id} items={a.items ?? []} canEdit={editor} />
            </section>
          )}
          {tab === "resources" && (
            <section id="panel-resources" role="tabpanel" aria-labelledby="tab-resources">
              <ResourcesPanel archiveId={id} canEdit={editor} />
            </section>
          )}

          {tab === "coverage" && (
            <section id="panel-coverage" role="tabpanel" aria-labelledby="tab-coverage" className="space-y-6">
              {editor && <BuildPanel archiveId={id} archiveTitle={a.title} />}
              <CoveragePanel archiveId={id} canEdit={editor} />
            </section>
          )}

          {tab === "material" && (
          <div id="panel-material" role="tabpanel" aria-labelledby="tab-material" className="space-y-8">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl">Material</h2>
              {editor && !adding && (
                <div className="flex flex-wrap gap-2">
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
              {(a.items ?? []).length === 0 && <li className="p-4 text-muted">{copy("emptyItems")}</li>}
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
          </div>
          )}

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
