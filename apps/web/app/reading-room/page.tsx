"use client";

import { ArchiveIcon, StatusIcon } from "@ultimyr/ui-icons";
import { Plus, Library } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Header } from "@/components/header";
import { Button, Field, Shell } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

interface DraftArchive {
  id: string;
  name: string;
}

// Local-only until the content service lands (Phase 3); not synced across devices.
const STORE = "ultimyr_draft_archives";

function loadDrafts(): DraftArchive[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as DraftArchive[]) : [];
  } catch {
    return [];
  }
}

export default function ReadingRoom() {
  const [drafts, setDrafts] = useState<DraftArchive[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => setDrafts(loadDrafts()), []);

  function create(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [...drafts, { id: crypto.randomUUID(), name: trimmed }];
    setDrafts(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {
      // Storage unavailable: the list still shows for this visit.
    }
    setName("");
    setCreating(false);
  }

  const { state } = useAuth();
  const { t, copy } = useNaming();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
  }, [state.status, router]);

  return (
    <>
      <Header />
      <Shell>
        {state.status !== "authenticated" ? (
          <StatusIcon status="loading" size={22} />
        ) : (
          <div className="ulti-fade space-y-10">
            <div>
              <h1 className="text-3xl">{t("dashboard")}</h1>
              <p className="text-muted">Welcome, {state.user.displayName}.</p>
            </div>
            <section className="rounded-lg border border-dashed border-line p-10 text-center">
              <div className="mx-auto mb-4 flex justify-center text-muted">
                <ArchiveIcon fallback={Library} size={32} />
              </div>
              <h2 className="text-xl">{t("archives")}</h2>
              {drafts.length === 0 ? (
                <p className="mx-auto mt-2 max-w-sm text-muted">{copy("emptyArchives")}</p>
              ) : (
                <ul className="mx-auto mt-3 max-w-sm divide-y divide-line rounded-md border border-line text-left">
                  {drafts.map((d) => (
                    <li key={d.id} className="px-3 py-2">
                      {d.name}
                    </li>
                  ))}
                </ul>
              )}
              {creating ? (
                <form onSubmit={create} className="mx-auto mt-5 max-w-xs space-y-3 text-left">
                  <Field id="archive-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
                  <div className="flex gap-2">
                    <Button type="submit" disabled={!name.trim()}>
                      Create
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => setCreating(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button variant="quiet" className="mt-5" onClick={() => setCreating(true)}>
                  <Plus size={16} aria-hidden /> New {t("archive").toLowerCase()}
                </Button>
              )}
            </section>
          </div>
        )}
      </Shell>
    </>
  );
}
