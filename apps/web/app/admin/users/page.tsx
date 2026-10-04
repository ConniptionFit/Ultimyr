"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, ErrorLine } from "@/components/admin/bits";
import { Button } from "@/components/ui";
import { message, when } from "@/lib/admin";
import { useAuth } from "@/lib/auth";

interface Row { id: string; email: string; displayName: string; status: "active" | "suspended"; createdVia: string; createdAt: string; roles: string[] }
const ROLES: Array<[string, string]> = [
  ["platform_admin", "Administrator"],
  ["org_admin", "Org admin"],
  ["author", "Author"],
  ["learner", "Learner"],
];

export default function Users() {
  const { api, state } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const me = state.status === "authenticated" ? state.user.id : "";

  const load = useCallback(
    async (query: string) => {
      try {
        setRows(await api<Row[]>("GET", `admin/users?limit=200${query ? `&q=${encodeURIComponent(query)}` : ""}`));
        setError(null);
      } catch (e) {
        setError(message(e));
      }
    },
    [api],
  );
  useEffect(() => {
    void load("");
  }, [load]);

  async function patch(r: Row, body: { status?: string; roles?: string[] }) {
    try {
      await api("PATCH", `admin/users/${r.id}`, body);
      await load(q);
    } catch (e) {
      setError(message(e) === "last admin" ? "That would leave no active administrator." : message(e));
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl">Users</h2>
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(q.trim());
        }}
      >
        <input aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm" />
        <Button variant="quiet" type="submit">
          Search
        </Button>
      </form>
      <ErrorLine error={error} />
      <ul className="divide-y divide-line rounded-md border border-line">
        {rows.map((r) => (
          <li key={r.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {r.displayName} {r.id === me && <span className="text-muted">(you)</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {r.email} · joined {when(r.createdAt)} via {r.createdVia}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.status === "suspended" && <Badge tone="danger">Suspended</Badge>}
                <Button variant="quiet" className="px-3 py-1" disabled={r.id === me} onClick={() => patch(r, { status: r.status === "active" ? "suspended" : "active" })}>
                  {r.status === "active" ? "Suspend" : "Reinstate"}
                </Button>
              </div>
            </div>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
              <legend className="sr-only">Roles for {r.displayName}</legend>
              {ROLES.map(([role, label]) => (
                <label key={role} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={r.roles.includes(role)}
                    disabled={role === "platform_admin" && r.id === me}
                    onChange={(e) => patch(r, { roles: e.target.checked ? [...r.roles, role] : r.roles.filter((x) => x !== role) })}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </li>
        ))}
        {!rows.length && <li className="p-4 text-sm text-muted">No one matches.</li>}
      </ul>
    </div>
  );
}
