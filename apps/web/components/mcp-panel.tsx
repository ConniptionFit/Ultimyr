"use client";

import { Copy } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";

interface Connection { id: string; clientName: string; scopes: string[]; createdAt: string; lastUsedAt: string | null }

/** Settings: connect Claude (or any MCP client) and manage which apps are connected. */
export function McpPanel() {
  const { api } = useAuth();
  const [conns, setConns] = useState<Connection[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const address = typeof window === "undefined" ? "" : `${window.location.origin}/mcp`;

  const load = useCallback(async () => {
    try {
      setConns(await api<Connection[]>("GET", "me/mcp-connections"));
    } catch (e) {
      setError(e instanceof ApiError ? e.code.replaceAll("_", " ") : "Could not reach the server.");
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-4 border-t border-line pt-8" aria-label="Connected apps">
      <div>
        <h2 className="text-xl">Connected apps (MCP)</h2>
        <p className="text-sm text-muted">Let Claude or another MCP app read your material and add drafts. It signs in with you and only gets the permissions you approve.</p>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-line p-3">
        <code className="min-w-0 flex-1 truncate text-sm">{address}</code>
        <Button
          variant="quiet"
          aria-label="Copy address"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(address);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard can be blocked; the address is visible to copy by hand */
            }
          }}
        >
          <Copy size={16} aria-hidden /> {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>In Claude, open Settings, then Connectors, then add a custom connector.</li>
        <li>Paste the address above and approve the request when Ultimyr asks.</li>
        <li>For tools that cannot sign in, create an API key above and send it as <code>Authorization: Bearer ulk_…</code>.</li>
      </ol>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {conns.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {conns.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.clientName}</span>
                <span className="text-muted">
                  {c.scopes.join(", ")} · last used {c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : "never"}
                </span>
              </span>
              <Button
                variant="quiet"
                className="text-danger"
                onClick={async () => {
                  if (!confirm(`Disconnect ${c.clientName}?`)) return;
                  await api("DELETE", `me/mcp-connections/${c.id}`).catch(() => setError("Could not disconnect."));
                  await load();
                }}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
