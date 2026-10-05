"use client";

import { FolderTree, NotebookPen } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { isRiskyFolder, notesMessage, type NotesPreview, type ScaffoldResult } from "@/lib/notes";

/** Shown before the first Create notes: pick the folder, see the exact file tree that will be made, then create it. */
export function NotesSetup({ archiveId, initialRoot, onDone, onCancel }: { archiveId: string; initialRoot: string; onDone: (r: ScaffoldResult) => void; onCancel: () => void }) {
  const { api } = useAuth();
  const [root, setRoot] = useState(initialRoot);
  const [folders, setFolders] = useState<string[]>([]);
  const [preview, setPreview] = useState<NotesPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ folders: string[] }>("GET", "notes/folders")
      .then((r) => setFolders(r.folders))
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<NotesPreview>("GET", `notes/archives/${archiveId}/preview?root=${encodeURIComponent(root)}`)
        .then(setPreview)
        .catch((e) => setError(e instanceof ApiError ? notesMessage(e.code) : "Could not preview the notes."));
    }, 250);
    return () => clearTimeout(t);
  }, [api, archiveId, root]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      if (preview && preview.root !== initialRoot) await api("PUT", "notes/preferences", { rootFolder: preview.root });
      onDone(await api<ScaffoldResult>("POST", `notes/archives/${archiveId}/scaffold`));
    } catch (e) {
      setError(e instanceof ApiError ? notesMessage(e.code) : "Could not create the notes.");
      setBusy(false);
    }
  }

  const depthOf = (path: string) => path.slice(preview!.root.length + 1).split("/").length - 1;
  return (
    <section aria-label="Set up notes" className="space-y-3 rounded-md border border-line p-4">
      <div className="flex items-center gap-2">
        <FolderTree size={18} aria-hidden className="text-muted" />
        <h3 className="text-lg">Set up your notes</h3>
      </div>
      <p className="text-sm text-muted">One note per step will be created in your Obsidian vault, in this folder structure. Nothing that already exists is touched.</p>
      <div className="space-y-1">
        <label htmlFor="setup-root" className="text-sm">
          Folder in your vault
        </label>
        <input id="setup-root" list="setup-folders" value={root} onChange={(e) => setRoot(e.target.value)} maxLength={200} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" />
        <datalist id="setup-folders">
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        {isRiskyFolder(root) && <p className="text-xs text-danger">Folders that start with a dot are Obsidian&apos;s own settings. Pick a normal folder.</p>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {preview && (
        <div className="max-h-72 overflow-auto rounded-md border border-line bg-surface p-3 font-mono text-xs" aria-label="Files that will be created">
          <p className="mb-1 text-muted">{preview.root}/</p>
          <ul>
            {preview.notes.map((n) => (
              <li key={n.path} style={{ paddingLeft: `${(n.kind === "index" ? 0 : depthOf(n.path)) * 0.9 + 0.9}rem` }} className="truncate" title={n.path}>
                {n.path.split("/").slice(-1)[0]}
              </li>
            ))}
          </ul>
          {preview.truncated && <p className="mt-1 text-muted">…and more ({preview.total} in all). Too many to create in one go.</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={create} disabled={busy || !preview || preview.truncated || isRiskyFolder(root)}>
          <NotebookPen size={16} aria-hidden /> {busy ? "Creating…" : `Create ${preview?.total ?? ""} notes`}
        </Button>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
