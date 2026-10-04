"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, ErrorLine } from "@/components/admin/bits";
import { Button, Field } from "@/components/ui";
import { message, when } from "@/lib/admin";
import { useAuth } from "@/lib/auth";

interface Token { id: string; name: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

export default function Provisioning() {
  const { api } = useAuth();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = typeof window === "undefined" ? "" : `${window.location.origin}/scim/v2`;

  const load = useCallback(async () => {
    try {
      setTokens(await api<Token[]>("GET", "admin/scim-tokens"));
    } catch (e) {
      setError(message(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const t = await api<{ token: string }>("POST", "admin/scim-tokens", { name });
      setFresh(t.token);
      setName("");
      await load();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl">Provisioning (SCIM)</h2>
      <p className="text-sm text-muted">Let your identity provider create, update and deactivate accounts and groups automatically. Create a token, then paste it and the address below into the provider.</p>
      <div className="rounded-md border border-line p-3 text-sm">
        <span className="text-muted">SCIM base address: </span>
        <code className="break-all">{base}</code>
      </div>
      <ErrorLine error={error} />
      {fresh && (
        <div role="status" className="space-y-1 rounded-md border border-accent p-4 text-sm">
          <p>Copy this token now. It is shown once.</p>
          <code className="block break-all">{fresh}</code>
          <Button variant="quiet" className="mt-2" onClick={() => setFresh(null)}>
            Done
          </Button>
        </div>
      )}
      <form onSubmit={create} className="flex items-end gap-2">
        <div className="flex-1">
          <Field id="scim-name" label="New token name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </div>
        <Button type="submit">Create token</Button>
      </form>
      <ul className="divide-y divide-line rounded-md border border-line">
        {tokens.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
            <div>
              <p className="text-sm">{t.name}</p>
              <p className="text-xs text-muted">
                Created {when(t.createdAt)} · last used {when(t.lastUsedAt)}
              </p>
            </div>
            {t.revokedAt ? (
              <Badge tone="danger">Revoked</Badge>
            ) : (
              <Button variant="quiet" className="px-3 py-1" onClick={async () => { try { await api("DELETE", `admin/scim-tokens/${t.id}`); await load(); } catch (e) { setError(message(e)); } }}>
                Revoke
              </Button>
            )}
          </li>
        ))}
        {!tokens.length && <li className="p-4 text-sm text-muted">No tokens yet.</li>}
      </ul>
    </div>
  );
}
