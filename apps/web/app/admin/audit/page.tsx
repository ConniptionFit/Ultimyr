"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function Audit() {
  const { api } = useAuth();
  const [rows, setRows] = useState<Entry[]>([]);
  const [action, setAction] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<Entry[]>("GET", `admin/audit?limit=200${action ? `&action=${encodeURIComponent(action)}` : ""}`));
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }, [api, action]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <h2 className="text-2xl">Audit log</h2>
      <p className="text-sm text-muted">The latest 200 sign-ins, security changes and admin actions.</p>
      <select aria-label="Filter" className={selectCls} value={action} onChange={(e) => setAction(e.target.value)}>
        {FILTERS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
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
    </div>
  );
}
