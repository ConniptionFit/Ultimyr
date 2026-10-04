"use client";

import { ArchiveIcon } from "@ultimyr/ui-icons";
import { Library, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertsBanner } from "@/components/credentials/alerts-banner";
import { Loading } from "@/components/loading";
import { Header } from "@/components/header";
import { Button, Field, Shell } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { loadExample } from "@/lib/example";
import { iconFor } from "@/lib/icons";
import { useNaming } from "@/lib/naming";
import { ProgressBar, totalsText } from "@/components/roadmap/bits";
import type { Archive, RoadmapSummary } from "@/lib/types";

// Archives created before the content service existed were kept in this browser only.
const LEGACY_STORE = "ultimyr_draft_archives";

export default function ReadingRoom() {
  const { state, api } = useAuth();
  const { t, copy } = useNaming();
  const router = useRouter();
  const [archives, setArchives] = useState<Archive[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paths, setPaths] = useState<RoadmapSummary[]>([]);

  const load = useCallback(async () => {
    try {
      setArchives((await api<{ archives: Archive[] }>("GET", "archives")).archives);
      // Roadmaps are a bonus on this page: if they fail to load, the list above still works.
      setPaths((await api<{ roadmaps: RoadmapSummary[] }>("GET", "roadmaps").catch(() => ({ roadmaps: [] }))).roadmaps);
    } catch {
      setArchives([]);
      setError("Could not load your list. Is the content service running?");
    }
  }, [api]);

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status !== "authenticated") return;
    (async () => {
      // One-time move of locally stored drafts into the real service.
      try {
        const raw = JSON.parse(localStorage.getItem(LEGACY_STORE) ?? "[]") as { name?: string }[];
        if (Array.isArray(raw) && raw.length) {
          for (const d of raw) if (d.name) await api("POST", "archives", { title: d.name.slice(0, 120) });
          localStorage.removeItem(LEGACY_STORE);
        }
      } catch {
        // Nothing to migrate, or the service is down: the list below reports that.
      }
      await load();
    })();
  }, [state.status, router, api, load]);

  async function tryExample() {
    setBusy(true);
    setError(null);
    try {
      router.push(`/archives/${await loadExample(api)}`);
    } catch {
      setError("Could not add the example. You may not have permission to create new material.");
      setBusy(false);
    }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const a = await api<Archive>("POST", "archives", { title: String(f.get("title")).trim(), vendor: String(f.get("vendor") ?? "").trim() || null });
      router.push(`/archives/${a.id}`);
    } catch {
      setError("Could not create it. You may not have permission to create new material.");
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <Shell>
        {state.status !== "authenticated" || archives === null ? (
          <Loading />
        ) : (
          <div className="ulti-fade space-y-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl">{t("dashboard")}</h1>
                <p className="text-muted">Welcome, {state.user.displayName}.</p>
              </div>
              {!creating && (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} aria-hidden /> New {t("archive").toLowerCase()}
                </Button>
              )}
            </div>
            {creating && (
              <form onSubmit={create} className="space-y-3 rounded-md border border-line p-4">
                <Field id="archive-title" name="title" label="Name" placeholder="CompTIA A+ Core 1" required maxLength={120} autoFocus />
                <Field id="archive-vendor" name="vendor" label="Vendor (optional)" maxLength={120} />
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>
                    Create
                  </Button>
                  <Button type="button" variant="quiet" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <AlertsBanner />
            {paths.length > 0 && (
              <section aria-labelledby="paths-h">
                <h2 id="paths-h" className="mb-3 text-xl">
                  {paths.some((p) => p.started) ? "Keep going" : t("roadmap")}
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {paths.map((p) => (
                    <li key={p.archiveId}>
                      <Link href={`/archives/${p.archiveId}#roadmap`} className="block h-full space-y-2 rounded-md border border-line p-4 hover:bg-surface">
                        <span className="flex items-center gap-2">
                          <span className="text-accent">
                            <ArchiveIcon pngUrl={p.icon.url} fallback={iconFor(p.icon.name)} size={20} />
                          </span>
                          <span className="truncate font-serif text-lg">{p.title}</span>
                        </span>
                        <ProgressBar totals={p.totals} label={`${p.title} progress`} />
                        <span className="block text-sm text-muted">
                          {p.totals.percent}% · {totalsText(p.totals)}
                        </span>
                        {p.next ? <span className="block truncate text-sm">Next: {p.next.title}</span> : <span className="block text-sm text-accent">{copy("roadmapDone")}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h2 className="mb-3 text-xl">{t("archives")}</h2>
              {archives.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line p-10 text-center">
                  <div className="mx-auto mb-4 flex justify-center text-muted">
                    <ArchiveIcon fallback={Library} size={32} />
                  </div>
                  <p className="mx-auto max-w-sm text-muted">{copy("emptyArchives")}</p>
                  <div className="mt-4">
                    <Button variant="quiet" onClick={tryExample} disabled={busy}>
                      Add a small example to explore
                    </Button>
                  </div>
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {archives.map((a) => (
                    <li key={a.id}>
                      <Link href={`/archives/${a.id}`} className="flex h-full gap-3 rounded-md border border-line p-4 hover:bg-surface">
                        <span className="mt-0.5 text-accent">
                          <ArchiveIcon pngUrl={a.icon.url} fallback={iconFor(a.icon.name)} size={28} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-serif text-lg">{a.title}</span>
                          <span className="block text-sm text-muted">
                            {[a.vendor, `${a.itemCount ?? 0} items`, a.relation === "owner" ? null : "shared with you"].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Shell>
    </>
  );
}
