"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, ErrorLine, selectCls } from "@/components/admin/bits";
import { Button, Field } from "@/components/ui";
import { message } from "@/lib/admin";
import { useAuth } from "@/lib/auth";

interface Group { id: string; name: string; source: string; members: number }
interface Member { id: string; email: string; displayName: string }
interface UserRow { id: string; email: string; displayName: string }

export default function Groups() {
  const { api } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [name, setName] = useState("");
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGroups(await api<Group[]>("GET", "admin/groups"));
    } catch (e) {
      setError(message(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function show(id: string) {
    if (open === id) return setOpen(null);
    try {
      const [m, u] = await Promise.all([api<Member[]>("GET", `admin/groups/${id}/members`), api<UserRow[]>("GET", "admin/users?limit=200")]);
      setMembers(m);
      setUsers(u);
      setPick("");
      setOpen(id);
    } catch (e) {
      setError(message(e));
    }
  }
  async function run(fn: () => Promise<unknown>, reopen?: string) {
    setError(null);
    try {
      await fn();
      await load();
      if (reopen) setMembers(await api<Member[]>("GET", `admin/groups/${reopen}/members`));
    } catch (e) {
      setError(message(e) === "group exists" ? "A group with that name already exists." : message(e));
    }
  }
  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api("POST", "admin/groups", { name });
      setName("");
    });
  };

  return (
    <div className="space-y-5">
      <h2 className="text-2xl">Groups</h2>
      <p className="text-sm text-muted">Groups let you share an Archive with a whole class or team. Groups from SSO or SCIM are managed by your identity provider and are read only here.</p>
      <form onSubmit={create} className="flex items-end gap-2">
        <div className="flex-1">
          <Field id="group-name" label="New group" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </div>
        <Button type="submit">Create</Button>
      </form>
      <ErrorLine error={error} />
      <ul className="divide-y divide-line rounded-md border border-line">
        {groups.map((g) => (
          <li key={g.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button className="text-left text-sm hover:text-accent" aria-expanded={open === g.id} onClick={() => show(g.id)}>
                {g.name} <span className="text-muted">({g.members})</span>
              </button>
              <div className="flex items-center gap-2">
                <Badge>{g.source}</Badge>
                {g.source === "local" && (
                  <Button variant="quiet" className="px-3 py-1" onClick={() => run(() => api("DELETE", `admin/groups/${g.id}`))}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
            {open === g.id && (
              <div className="mt-3 space-y-3">
                <ul className="space-y-1 text-sm">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        {m.displayName} <span className="text-xs text-muted">{m.email}</span>
                      </span>
                      {g.source === "local" && (
                        <Button variant="quiet" className="px-2 py-0.5 text-xs" onClick={() => run(() => api("DELETE", `admin/groups/${g.id}/members/${m.id}`), g.id)}>
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                  {!members.length && <li className="text-muted">No members yet.</li>}
                </ul>
                {g.source === "local" && (
                  <div className="flex gap-2">
                    <select aria-label="Add a person" className={`${selectCls} min-w-0 flex-1`} value={pick} onChange={(e) => setPick(e.target.value)}>
                      <option value="">Add a person</option>
                      {users.filter((u) => !members.some((m) => m.id === u.id)).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName} ({u.email})
                        </option>
                      ))}
                    </select>
                    <Button variant="quiet" disabled={!pick} onClick={() => run(async () => { await api("POST", `admin/groups/${g.id}/members`, { userId: pick }); setPick(""); }, g.id)}>
                      Add
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
        {!groups.length && <li className="p-4 text-sm text-muted">No groups yet.</li>}
      </ul>
    </div>
  );
}
