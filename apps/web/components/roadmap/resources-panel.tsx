"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { RESOURCE_KINDS, type Resource } from "@/lib/types";
import { ExternalLinkText, KIND_ICON, KIND_LABEL, minutesText } from "./bits";

/** The links saved in an archive: videos, articles, courses. Editors add and remove them; everyone can open them. */
export function ResourcesPanel({ archiveId, canEdit }: { archiveId: string; canEdit: boolean }) {
  const { api } = useAuth();
  const { copy } = useNaming();
  const [list, setList] = useState<Resource[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList((await api<{ resources: Resource[] }>("GET", `archives/${archiveId}/resources`)).resources);
    } catch {
      setList([]);
      setError("Could not load the links.");
    }
  }, [api, archiveId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      await api("POST", `archives/${archiveId}/resources`, {
        url: String(f.get("url")).trim(),
        title: String(f.get("title")).trim(),
        ...(f.get("kind") ? { kind: String(f.get("kind")) } : {}),
        summary: String(f.get("summary") ?? ""),
        ...(Number(f.get("minutes")) ? { minutes: Number(f.get("minutes")) } : {}),
      });
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0] ?? err.code.replaceAll("_", " ")) : "Could not add that link.");
    }
  }

  async function publish(r: Resource) {
    await api("PATCH", `resources/${r.id}`, { status: "published" });
    await load();
  }
  async function remove(r: Resource) {
    if (!confirm(`Remove "${r.title}"? It also leaves any roadmap step that uses it.`)) return;
    await api("DELETE", `resources/${r.id}`);
    await load();
  }

  if (!list) return <p className="text-muted">{copy("loading")}</p>;
  return (
    <div className="space-y-4">
      {canEdit && !adding && (
        <Button variant="quiet" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden /> Add a link
        </Button>
      )}
      {adding && (
        <form onSubmit={add} className="grid gap-3 rounded-md border border-line p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="res-url" name="url" type="url" label="Link (https)" placeholder="https://www.youtube.com/watch?v=..." required pattern="https://.*" maxLength={2000} autoFocus />
          </div>
          <Field id="res-title" name="title" label="Title" required maxLength={200} />
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label htmlFor="res-kind" className="text-sm text-muted">
                Kind
              </label>
              <select id="res-kind" name="kind" defaultValue="" className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                <option value="">Auto</option>
                {RESOURCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <Field id="res-min" name="minutes" type="number" min={1} max={6000} label="Minutes" />
          </div>
          <div className="sm:col-span-2">
            <Field id="res-sum" name="summary" label="What you get from it (optional)" maxLength={1000} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit">Save link</Button>
            <Button type="button" variant="quiet" onClick={() => setAdding(false)}>
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
      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-line p-6 text-center text-muted">{copy("emptyResources")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {list.map((r) => {
            const Icon = KIND_ICON[r.kind];
            return (
              <li key={r.id} className="flex items-start gap-3 p-3">
                <Icon size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p>
                    <ExternalLinkText resource={r} />
                    {r.status === "draft" && <span className="ml-2 rounded-full border border-line px-2 text-xs text-muted">draft</span>}
                  </p>
                  <p className="text-xs text-muted">{[KIND_LABEL[r.kind], r.provider, minutesText(r.minutes)].filter(Boolean).join(" · ")}</p>
                  {r.summary && <p className="mt-1 text-sm text-muted">{r.summary}</p>}
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    {r.status === "draft" && (
                      <Button variant="quiet" onClick={() => publish(r)}>
                        Publish
                      </Button>
                    )}
                    <Button variant="quiet" className="text-danger" aria-label={`Remove ${r.title}`} onClick={() => remove(r)}>
                      <Trash2 size={16} />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
