"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { ErrorLine, selectCls } from "@/components/admin/bits";
import { message, when } from "@/lib/admin";
import { useAuth } from "@/lib/auth";

interface Entry { id: number; ts: string; actorId: string | null; action: string; target: string | null; ip: string | null }
const FILTERS: Array<[string, string]> = [
  ["", "Everything"],
  ["login.failed", "Failed sign-ins"],
  ["login.success", "Sign-ins"],
  ["admin.user_updated", "User changes"],
  ["admin.settings_updated", "Setting changes"],
];

const PAGE = 100;

export default function Audit() {
  const { api, state } = useAuth();
  const [actions, setActions] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [rows, setRows] = useState<Entry[]>([]);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const first = await api<Entry[]>("GET", `admin/audit?limit=${PAGE}${action ? `&action=${encodeURIComponent(action)}` : ""}`);
      setRows(first);
      setMore(first.length === PAGE);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api, action]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<string[]>("GET", "admin/audit/actions").then(setActions).catch(() => setActions([]));
  }, [api]);

  async function loadMore() {
    const last = rows[rows.length - 1];
    if (!last) return;
    try {
      const next = await api<Entry[]>("GET", `admin/audit?limit=${PAGE}&before=${last.id}${action ? `&action=${encodeURIComponent(action)}` : ""}`);
      setRows([...rows, ...next]);
      setMore(next.length === PAGE);
    } catch (e) {
      setError(message(e));
    }
  }

  async function exportCsv() {
    if (state.status !== "authenticated") return;
    const res = await fetch(`/api/v1/admin/audit?format=csv&limit=5000${action ? `&action=${encodeURIComponent(action)}` : ""}`, { headers: { authorization: `Bearer ${state.accessToken}` } });
    if (!res.ok) return setError("Export failed.");
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "ultimyr-audit-log.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl">Audit log</h2>
      <p className="text-sm text-muted">Sign-ins, security changes and admin actions, newest first. Export gives up to the latest 5,000 matching entries as a spreadsheet file.</p>
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Filter" className={selectCls} value={action} onChange={(e) => setAction(e.target.value)}>
          {FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
          {actions.length > 0 && (
            <optgroup label="All actions">
              {actions
                .filter((a) => !FILTERS.some(([v]) => v === a))
                .map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
        <Button variant="quiet" onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <ErrorLine error={error} />
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th className="p-2 font-normal">When</th>
              <th className="p-2 font-normal">Action</th>
              <th className="p-2 font-normal">Who</th>
              <th className="p-2 font-normal">Target</th>
              <th className="p-2 font-normal">Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap p-2">{when(r.ts)}</td>
                <td className="p-2">{r.action}</td>
                <td className="max-w-[10rem] truncate p-2">{r.actorId ?? "system"}</td>
                <td className="max-w-[10rem] truncate p-2">{r.target ?? ""}</td>
                <td className="p-2">{r.ip ?? ""}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="p-3 text-muted">
                  Nothing logged.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {more && (
        <Button variant="quiet" onClick={loadMore}>
          Load older entries
        </Button>
      )}
    </div>
  );
}
