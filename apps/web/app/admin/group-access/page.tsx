"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, ErrorLine, selectCls } from "@/components/admin/bits";
import { Button } from "@/components/ui";
import { message } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

interface Group { id: string; name: string }
interface Row { archiveId: string; title: string; access: "everyone" | "restricted"; level: "none" | "view" | "manage" | "attempt" | "owner" }
interface ArchiveRow { id: string; title: string; access: "everyone" | "restricted" }
interface UserRow { id: string; email: string; displayName: string }
interface Delegate { userId: string }

const LEVELS: Array<[string, string]> = [
  ["none", "No access"],
  ["view", "Can view"],
  ["manage", "Can manage"],
];

export default function GroupAccess() {
  const { api, state } = useAuth();
  const { t } = useNaming();
  const isAdmin = state.status === "authenticated" && state.user.roles.includes("platform_admin");
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
      setError(message(e) === "forbidden" ? "That group's access was set by the owner. Ask an administrator to change it." : message(e));
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
          {isAdmin ? " Content open to everyone stays visible to everyone until you restrict it, so nothing disappears by accident." : " You can manage the groups of the " + courses + " an administrator delegated to you."}
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
                    {isAdmin && (
                      <button className="text-xs text-muted underline hover:text-ink" onClick={() => setMode(r, r.access === "everyone" ? "restricted" : "everyone")}>
                        {r.access === "everyone" ? "Restrict" : "Open to everyone"}
                      </button>
                    )}
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
      {isAdmin && <Delegates />}
    </div>
  );
}

/** Administrators pick, per course, the people who may manage its group access. */
function Delegates() {
  const { api } = useAuth();
  const { t } = useNaming();
  const [archives, setArchives] = useState<ArchiveRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const name = (id: string) => users.find((u) => u.id === id)?.displayName ?? "Unknown person";

  useEffect(() => {
    Promise.all([api<ArchiveRow[]>("GET", "group-access/archives"), api<UserRow[]>("GET", "admin/users?limit=200")]).then(([a, u]) => {
      setArchives(a);
      setUsers(u);
    }, (e) => setError(message(e)));
  }, [api]);

  const show = useCallback(
    async (id: string) => {
      try {
        setDelegates(await api<Delegate[]>("GET", `group-access/archives/${id}/delegates`));
      } catch (e) {
        setError(message(e));
      }
    },
    [api],
  );
  async function toggle(id: string) {
    setPick("");
    if (open === id) return setOpen(null);
    setOpen(id);
    await show(id);
  }
  async function run(id: string, fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await show(id);
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section className="space-y-4">
      <h2 className="text-2xl">Delegates</h2>
      <p className="text-sm text-muted">
        A delegate can manage which groups use a {t("archive").toLowerCase()} you choose, and nothing else: no other settings, no other {t("archives").toLowerCase()}, and no change to who can see it. Give someone the <strong>Access delegate</strong> role under Users, then pick them here.
      </p>
      <ErrorLine error={error} />
      <ul className="divide-y divide-line rounded-md border border-line">
        {archives.map((a) => (
          <li key={a.id} className="p-3">
            <button className="text-left text-sm hover:text-accent" aria-expanded={open === a.id} onClick={() => toggle(a.id)}>
              {a.title}
            </button>
            {open === a.id && (
              <div className="mt-3 space-y-3">
                <ul className="space-y-1 text-sm">
                  {delegates.map((d) => (
                    <li key={d.userId} className="flex items-center justify-between gap-2">
                      <span className="truncate">{name(d.userId)}</span>
                      <Button variant="quiet" className="px-2 py-0.5 text-xs" onClick={() => run(a.id, () => api("DELETE", `group-access/archives/${a.id}/delegates/${d.userId}`))}>
                        Remove
                      </Button>
                    </li>
                  ))}
                  {!delegates.length && <li className="text-muted">No delegates yet.</li>}
                </ul>
                <div className="flex gap-2">
                  <select aria-label="Add a delegate" className={`${selectCls} min-w-0 flex-1`} value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Add a delegate</option>
                    {users.filter((u) => !delegates.some((d) => d.userId === u.id)).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.displayName} ({u.email})
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="quiet"
                    disabled={!pick}
                    onClick={() => run(a.id, async () => { await api("POST", `group-access/archives/${a.id}/delegates`, { userId: pick }); setPick(""); })}
                  >
                    Add
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
        {!archives.length && <li className="p-4 text-sm text-muted">No {t("archives").toLowerCase()} yet.</li>}
      </ul>
    </section>
  );
}
