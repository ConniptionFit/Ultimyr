"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Card, ErrorLine } from "@/components/admin/bits";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { notesMessage, type NotesAdmin } from "@/lib/notes";

const fail = (e: unknown) => (e instanceof ApiError ? notesMessage(e.code) : "Could not reach the server.");

/** Admin panel: where the Fast Note Sync server is. One setting for everyone; people connect their own vault in Settings. */
export default function AdminNotes() {
  const { api } = useAuth();
  const [info, setInfo] = useState<NotesAdmin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api<NotesAdmin>("GET", "notes/admin"));
    } catch (e) {
      setError(fail(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const url = String(new FormData(e.currentTarget).get("url")).trim();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api("PUT", "notes/admin", { fnsUrl: url || null });
      setNote(url ? "Saved. The server answered, and people can now connect their vaults in Settings." : "Address removed. Notes are off until you add one.");
      await load();
    } catch (err) {
      setError(fail(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl">Notes (Obsidian)</h1>
        <p className="text-sm text-muted">Let people keep their study notes in Obsidian through Fast Note Sync, and edit them next to the roadmap.</p>
      </div>
      <ErrorLine error={error} />
      {note && (
        <p role="status" className="text-sm text-muted">
          {note}
        </p>
      )}
      {info && (
        <Card title="Server address" hint="Where Ultimyr reaches your Fast Note Sync server. Only administrators can change it.">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            {info.fnsUrl ? <>Current: <code>{info.fnsUrl}</code></> : "No address set yet."}
            {info.source === "env" && <Badge>set in the server environment</Badge>}
            {info.source === "admin" && <Badge tone="accent">set here</Badge>}
          </p>
          {!info.keyPresent && (
            <p role="alert" className="text-sm text-danger">
              The encryption key is missing, so notes cannot work yet. Run <code>./scripts/init-secrets.sh</code> on the server, then <code>docker compose up -d notes</code>. The same key protects people&apos;s saved AI keys.
            </p>
          )}
          {info.canEdit ? (
            <form onSubmit={save} className="space-y-3">
              <Field id="fns-url" name="url" label="Fast Note Sync address" type="url" placeholder="http://fns:9000" defaultValue={info.fnsUrl ?? ""} />
              <p className="text-xs text-muted">
                Use the address the Ultimyr server can reach. Running Fast Note Sync in the same Docker stack (docker-compose.notes.yml)? It is <code>http://fns:9000</code>. Elsewhere on your network, use its IP or name. It is checked before saving. Leave empty to turn notes off.
              </p>
              <Button type="submit" disabled={busy}>
                Check and save
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">{notesMessage("set_by_environment")}</p>
          )}
        </Card>
      )}
      <Card title="How people connect" hint="Each person does this once, in Settings, Notes.">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Open your Fast Note Sync web page, create an account and a vault, and install its Obsidian plugin.</li>
          <li>In Ultimyr, Settings, Notes: paste the API token, pick the vault, choose a folder.</li>
          <li>Press Set up notes on any roadmap.</li>
        </ol>
        <p className="text-xs text-muted">Tokens are encrypted with the server key and never shown again. Notes stay in the vault; Ultimyr never keeps a copy.</p>
      </Card>
    </div>
  );
}
