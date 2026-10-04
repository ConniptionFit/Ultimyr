"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { notesMessage, type NotesConnection } from "@/lib/notes";

const fail = (e: unknown) => (e instanceof ApiError ? notesMessage(e.code) : "Could not reach the server.");

/** Settings: connect your Fast Note Sync vault. The token is write-only: once saved it is sealed and never shown again. */
export function NotesPanel() {
  const { api } = useAuth();
  const [conn, setConn] = useState<NotesConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setConn(await api<NotesConnection>("GET", "notes/connection"));
    } catch (e) {
      setError(fail(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function connect(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api("PUT", "notes/connection", { token: String(f.get("token")).trim(), vault: String(f.get("vault")).trim() });
      form.reset();
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

  return (
    <section className="space-y-4 border-t border-line pt-8" aria-label="Notes">
      <div>
        <h2 className="text-xl">Notes (Obsidian)</h2>
        <p className="text-sm text-muted">
          Keep one note per step in your Obsidian vault through Fast Note Sync, and edit it next to the step here. The layout is described in the note standard (docs/notes.md).
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
      {conn && !conn.enabled && <p className="rounded-md border border-dashed border-line p-4 text-sm text-muted">{notesMessage("notes_disabled")}</p>}
      {conn?.enabled && conn.connected && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line p-3 text-sm">
          <p>
            Connected to vault <strong>{conn.vault}</strong> on {conn.server}.
          </p>
          <Button variant="quiet" onClick={disconnect}>
            Disconnect
          </Button>
        </div>
      )}
      {conn?.enabled && (
        <form onSubmit={connect} className="space-y-3 rounded-md border border-line p-4">
          <p className="text-sm text-muted">
            {conn.connected ? "Replace your connection" : `Connect to ${conn.server}`}. In the Fast Note Sync web page, use Copy API Config and paste the token and the vault name.
          </p>
          <Field id="notes-vault" name="vault" label="Vault name" required maxLength={200} autoComplete="off" />
          <Field id="notes-token" name="token" label="API token" type="password" required minLength={8} maxLength={2000} autoComplete="off" />
          <Button type="submit" disabled={busy}>
            {conn.connected ? "Replace connection" : "Connect"}
          </Button>
        </form>
      )}
    </section>
  );
}
