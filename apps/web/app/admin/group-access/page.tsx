"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, ErrorLine, selectCls } from "@/components/admin/bits";
import { message } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

interface Group { id: string; name: string }
interface Row { archiveId: string; title: string; access: "everyone" | "restricted"; level: "none" | "view" | "manage" | "attempt" | "owner" }

const LEVELS: Array<[string, string]> = [
  ["none", "No access"],
  ["view", "Can view"],
  ["manage", "Can manage"],
];

export default function GroupAccess() {
  const { api } = useAuth();
  const { t } = useNaming();
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const courses = t("archives").toLowerCase();

  useEffect(() => {
    api<Group[]>("GET", "groups").then(setGroups, (e) => setError(message(e)));
  }, [api]);

  const loadRows = useCallback(async () => {
    if (!groupId) return setRows([]);
    try {
      setRows(await api<Row[]>("GET", `group-access/groups/${groupId}`));
    } catch (e) {
      setError(message(e));
    }
  }, [api, groupId]);
  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  async function setLevel(r: Row, level: string) {
    setError(null);
    try {
      await api("PUT", `group-access/archives/${r.archiveId}/groups/${groupId}`, { level });
      await loadRows();
    } catch (e) {
      setError(message(e));
    }
  }
  async function setMode(r: Row, mode: "everyone" | "restricted") {
    setError(null);
    try {
      await api("PUT", `group-access/archives/${r.archiveId}/access`, { mode });
      await loadRows();
    } catch (e) {
      setError(message(e));
    }
  }

  const shown = rows.filter((r) => r.title.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h2 className="text-2xl">{t("groupAccess")}</h2>
        <p className="text-sm text-muted">
          Choose a group, then say which {courses} it can use. Groups from your identity provider (SCIM or SSO) show up here as they sync. <strong>Can view</strong> lets members study the material. <strong>Can manage</strong> also lets them edit it.
          {" Content open to everyone stays visible to everyone until you restrict it, so nothing disappears by accident."}
        </p>
        <ErrorLine error={error} />
        <div className="flex flex-wrap gap-2">
          <select aria-label="Group" className={`${selectCls} min-w-0 flex-1`} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Choose a group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {groupId && rows.length > 8 && (
            <input aria-label={`Filter ${courses}`} placeholder={`Filter ${courses}`} className={`${selectCls} min-w-0 flex-1`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
        </div>
        {groupId && (
          <ul className="divide-y divide-line rounded-md border border-line">
            {shown.map((r) => (
              <li key={r.archiveId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{r.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone={r.access === "everyone" ? "accent" : "muted"}>{r.access === "everyone" ? "Open to everyone" : "Restricted"}</Badge>
                    <button className="text-xs text-muted underline hover:text-ink" onClick={() => setMode(r, r.access === "everyone" ? "restricted" : "everyone")}>
                      {r.access === "everyone" ? "Restrict" : "Open to everyone"}
                    </button>
                  </div>
                </div>
                <select aria-label={`Access for ${r.title}`} className={selectCls} value={r.level} onChange={(e) => setLevel(r, e.target.value)}>
                  {(r.level === "attempt" || r.level === "owner") && <option value={r.level}>{r.level === "owner" ? "Owner (set by owner)" : "Quizzes only"}</option>}
                  {LEVELS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </li>
            ))}
            {!shown.length && <li className="p-4 text-sm text-muted">{rows.length ? "Nothing matches." : `No ${courses} to manage yet.`}</li>}
          </ul>
        )}
      </section>
    </div>
  );
}
