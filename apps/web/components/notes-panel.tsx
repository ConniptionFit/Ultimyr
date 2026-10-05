"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Choice } from "@/components/display-panel";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { isRiskyFolder, notesMessage, type NotesConnection, type NotesPrefs } from "@/lib/notes";

const fail = (e: unknown) => (e instanceof ApiError ? notesMessage(e.code) : "Could not reach the server.");

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${done ? "border-accent bg-accent text-accent-ink" : "border-line text-muted"}`}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">
          {title}
          {done && <span className="sr-only"> (done)</span>}
        </p>
        {children}
      </div>
    </li>
  );
}

/** Settings: connect your Fast Note Sync vault, choose where notes live and how you want to work with them. */
export function NotesPanel() {
  const { api } = useAuth();
  const [conn, setConn] = useState<NotesConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vaults, setVaults] = useState<string[] | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [root, setRoot] = useState("");

  const load = useCallback(async () => {
    try {
      const c = await api<NotesConnection>("GET", "notes/connection");
      setConn(c);
      setRoot(c.prefs.rootFolder);
      if (c.connected && c.enabled) setFolders((await api<{ folders: string[] }>("GET", "notes/folders").catch(() => ({ folders: [] as string[] }))).folders);
    } catch (e) {
      setError(fail(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function check(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api<{ vaults: string[] }>("POST", "notes/connection/check", { token: String(new FormData(e.currentTarget).get("token")).trim() });
      if (!r.vaults.length) setError("The token works, but that server has no vault yet. Create one in the Fast Note Sync web page first, then check again.");
      setVaults(r.vaults);
    } catch (err) {
      setVaults(null);
      setError(fail(err));
    } finally {
      setBusy(false);
    }
  }

  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      await api("PUT", "notes/connection", { token: String(f.get("token")).trim(), vault: String(f.get("vault")) });
      setVaults(null);
      setNote("Connected. The token is encrypted and cannot be shown again.");
      await load();
    } catch (err) {
      setError(fail(err));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Fast Note Sync? Notes already in your vault stay where they are.")) return;
    setError(null);
    try {
      await api("DELETE", "notes/connection");
      setNote("Disconnected.");
      await load();
    } catch (err) {
      setError(fail(err));
    }
  }

  async function savePrefs(patch: Partial<NotesPrefs>) {
    setError(null);
    try {
      const next = await api<NotesPrefs>("PUT", "notes/preferences", patch);
      setConn((c) => (c ? { ...c, prefs: next } : c));
      setRoot(next.rootFolder);
      setNote("Saved.");
    } catch (err) {
      setError(fail(err));
    }
  }

  const prefs = conn?.prefs;
  return (
    <section className="space-y-5 border-t border-line pt-8" aria-label="Notes">
      <div>
        <h2 className="text-xl">Notes (Obsidian)</h2>
        <p className="text-sm text-muted">Keep a note for every step of your courses in Obsidian through Fast Note Sync. The folders mirror the course layout, and you can write in Ultimyr or in Obsidian.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      )}

      {conn && !conn.enabled && (
        <div className="space-y-2 rounded-md border border-dashed border-line p-4 text-sm">
          {conn.reason === "no_key" ? (
            <p>The server&apos;s encryption key is missing, so notes cannot be switched on. An administrator needs to run <code>./scripts/init-secrets.sh</code> and restart.</p>
          ) : (
            <p>
              Notes need a Fast Note Sync server first. {conn.admin ? <>You are an administrator: <Link href="/admin/notes" className="text-accent underline">add its address in Admin panel, Notes</Link>.</> : "Ask an administrator to add its address in the Admin panel."}
            </p>
          )}
          <p className="text-muted">No server yet? An administrator can start one with <code>docker compose -f docker-compose.yml -f docker-compose.notes.yml up -d</code>.</p>
        </div>
      )}

      {conn?.enabled && !conn.connected && (
        <ol className="space-y-5">
          <Step n={1} title={`Create your vault on ${conn.server}`} done>
            <p className="text-sm text-muted">Open the Fast Note Sync web page, sign up, create a vault, and install its plugin in Obsidian so your devices stay in sync.</p>
          </Step>
          <Step n={2} title="Paste your API token and check it">
            <form onSubmit={vaults ? connect : check} className="space-y-3">
              <Field id="notes-token" name="token" label="API token (Copy API Config on the Fast Note Sync page)" type="password" required minLength={8} maxLength={2000} autoComplete="off" onChange={() => setVaults(null)} />
              {vaults?.length ? (
                <div className="space-y-1">
                  <label htmlFor="notes-vault" className="text-sm text-muted">
                    Which vault should hold your notes?
                  </label>
                  <select id="notes-vault" name="vault" required className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
                    {vaults.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Button type="submit" disabled={busy}>
                {vaults?.length ? "Connect" : "Check token"}
              </Button>
            </form>
          </Step>
          <Step n={3} title="Choose a folder and how you work">
            <p className="text-sm text-muted">Appears here once you are connected.</p>
          </Step>
        </ol>
      )}

      {conn?.enabled && conn.connected && prefs && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3 text-sm">
            <p>
              Connected to vault <strong>{conn.vault}</strong> on {conn.server}.
            </p>
            <Button variant="quiet" onClick={disconnect}>
              Disconnect
            </Button>
          </div>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void savePrefs({ rootFolder: root });
            }}
          >
            <label htmlFor="notes-root" className="text-sm">
              Folder in your vault for Ultimyr notes
            </label>
            <p className="text-xs text-muted">
              Inside it, each course gets its own folder, then a folder per stage and a note per step, the same order as the course in Ultimyr. Pick one that exists or type a new one (up to three levels, like Study/Certifications).
            </p>
            <div className="flex flex-wrap gap-2">
              <input id="notes-root" list="notes-folders" value={root} onChange={(e) => setRoot(e.target.value)} maxLength={200} className="min-w-[14rem] flex-1 rounded-md border border-line bg-surface px-3 py-2 text-ink" />
              <datalist id="notes-folders">
                {folders.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <Button type="submit" disabled={root.trim() === prefs.rootFolder || !root.trim()}>
                Save folder
              </Button>
            </div>
            {isRiskyFolder(root) && <p className="text-xs text-danger">Folders that start with a dot are Obsidian&apos;s own settings. Pick a normal folder.</p>}
            <p className="text-xs text-muted">Changing it affects notes created from now on. Notes you already have stay where they are.</p>
          </form>

          <Choice<NotesPrefs["editor"]>
            legend="Where do you write your notes?"
            hint="In Ultimyr: edit beside each step. In Obsidian: the note icon opens the note in Obsidian or your Fast Note Sync dashboard instead."
            value={prefs.editor}
            onChange={(editor) => void savePrefs({ editor })}
            options={[["ultimyr", "In Ultimyr"], ["obsidian", "In Obsidian"]]}
          />
          {prefs.editor === "ultimyr" && (
            <Choice<NotesPrefs["pane"]>
              legend="Notes pane in Ultimyr"
              hint="Split screen puts the note beside the roadmap with a slider to resize. Full screen gives the note the whole page, with buttons back to the roadmap and the main menu."
              value={prefs.pane}
              onChange={(pane) => void savePrefs({ pane })}
              options={[["split", "Split screen with slider"], ["full", "Full screen"], ["off", "Off"]]}
            />
          )}
        </div>
      )}
    </section>
  );
}
