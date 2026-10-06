"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, ErrorLine } from "@/components/admin/bits";
import { Button, Field } from "@/components/ui";
import { message, when } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { downloadApi } from "@/lib/download";

interface Row { id: string; email: string; displayName: string; status: "active" | "suspended"; createdVia: string; mustChangePassword?: boolean; createdAt: string; roles: string[] }
const ROLES: Array<[string, string]> = [
  ["platform_admin", "Administrator"],
  ["org_admin", "Org admin"],
  ["curriculum_admin", "Curriculum admin"],
  ["author", "Author"],
  ["learner", "Learner"],
];

interface Created { email: string; temporaryPassword?: string; inviteUrl?: string; inviteExpiresAt?: string }

function Secret({ label, value, note }: { label: string; value: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1 rounded-md border border-accent p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="break-all font-mono text-sm">{value}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="quiet"
          className="px-3 py-1"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <span className="text-xs text-muted">{note}</span>
      </div>
    </div>
  );
}

function AddPerson({ onCreated, disabled }: { onCreated: () => void; disabled: boolean }) {
  const { t } = useNaming();
  const { api } = useAuth();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"invite" | "password">("invite");
  const [roles, setRoles] = useState<string[]>(["author", "learner"]);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "").trim();
    setError(null);
    try {
      const res = await api<Created>("POST", "admin/users", {
        email: String(f.get("email")).trim(),
        displayName: String(f.get("name")).trim(),
        roles,
        method,
        ...(method === "password" && password ? { password } : {}),
      });
      setCreated(res);
      setOpen(false);
      onCreated();
    } catch (err) {
      const m = message(err);
      setError(m === "email taken" ? "That email already has an account." : m === "local users disabled" ? "Local accounts are turned off in Sign-in methods." : m);
    }
  }

  return (
    <div className="space-y-3">
      {created && (
        <div className="space-y-2 rounded-md border border-line p-4">
          <p className="text-sm">
            Created {created.email}. {created.temporaryPassword ? "Share the temporary password with them. They choose their own at first sign-in." : `Send them the link${created.inviteExpiresAt ? `, valid until ${when(created.inviteExpiresAt)}` : ""}.`}
          </p>
          {created.temporaryPassword && <Secret label="Temporary password" value={created.temporaryPassword} note="Shown once. It cannot be recovered." />}
          {created.inviteUrl && <Secret label="Invite link" value={created.inviteUrl} note="Shown once. It works a single time." />}
          <Button variant="quiet" className="px-3 py-1" onClick={() => setCreated(null)}>
            Done
          </Button>
        </div>
      )}
      {disabled ? (
        <p className="text-sm text-muted">Local accounts are turned off, so people can only be added through single sign-on or SCIM. Change this in Sign-in methods.</p>
      ) : !open ? (
        <Button onClick={() => { setOpen(true); setCreated(null); }}>Add a person</Button>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-md border border-line p-5">
          <Field id="new-name" name="name" label="Name" required maxLength={80} />
          <Field id="new-email" name="email" type="email" label="Email" required />
          <fieldset className="space-y-1">
            <legend className="text-sm text-muted">How they get in</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="method" checked={method === "invite"} onChange={() => setMethod("invite")} className="mt-1" />
              <span>
                Invite link
                <span className="block text-xs text-muted">They open a one-time link (valid 7 days) and choose their own password.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="method" checked={method === "password"} onChange={() => setMethod("password")} className="mt-1" />
              <span>
                Temporary password
                <span className="block text-xs text-muted">They must replace it the first time they sign in.</span>
              </span>
            </label>
          </fieldset>
          {method === "password" && <Field id="new-password" name="password" type="text" label="Temporary password (leave empty to generate one)" autoComplete="off" minLength={12} />}
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1 text-sm text-muted">Roles</legend>
            {ROLES.map(([role, plain]) => {
              const label = role === "curriculum_admin" ? t("curriculumAdmin") : plain;
              return (
              <label key={role} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={roles.includes(role)} onChange={(e) => setRoles(e.target.checked ? [...roles, role] : roles.filter((x) => x !== role))} />
                {label}
              </label>
              );
            })}
          </fieldset>
          <ErrorLine error={error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!roles.length}>Create</Button>
            <Button type="button" variant="quiet" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function Users() {
  const { t } = useNaming();
  const { api, state } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [localOff, setLocalOff] = useState(false);
  const [link, setLink] = useState<{ id: string; url: string; expires: string } | null>(null);
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
    api<{ localUsersDisabled: boolean }>("GET", "admin/settings").then((s) => setLocalOff(s.localUsersDisabled), () => undefined);
  }, [load, api]);

  async function newLink(r: Row) {
    try {
      const res = await api<{ inviteUrl: string; inviteExpiresAt: string }>("POST", `admin/users/${r.id}/invite`);
      setLink({ id: r.id, url: res.inviteUrl, expires: res.inviteExpiresAt });
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  }

  async function patch(r: Row, body: { status?: string; roles?: string[] }) {
    try {
      await api("PATCH", `admin/users/${r.id}`, body);
      await load(q);
    } catch (e) {
      setError(message(e) === "last admin" ? "That would leave no active administrator." : message(e));
    }
  }

  async function exportCsv() {
    if (state.status !== "authenticated") return;
    if (!(await downloadApi(state.accessToken, `admin/users?format=csv${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`, "ultimyr-users.csv"))) setError("Export failed.");
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl">Users</h2>
      <AddPerson disabled={localOff} onCreated={() => void load(q)} />
      <div>
        <Button variant="quiet" onClick={exportCsv}>
          Export people as CSV
        </Button>
      </div>
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
                {r.mustChangePassword && <Badge>Temporary password</Badge>}
                {r.createdVia === "local" && !localOff && (
                  <Button variant="quiet" className="px-3 py-1" onClick={() => newLink(r)}>
                    New sign-in link
                  </Button>
                )}
                <Button variant="quiet" className="px-3 py-1" disabled={r.id === me} onClick={() => patch(r, { status: r.status === "active" ? "suspended" : "active" })}>
                  {r.status === "active" ? "Suspend" : "Reinstate"}
                </Button>
              </div>
            </div>
            {link?.id === r.id && <Secret label="Sign-in link" value={link.url} note={`Shown once, valid until ${when(link.expires)}. Older links stop working.`} />}
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
              <legend className="sr-only">Roles for {r.displayName}</legend>
              {ROLES.map(([role, plain]) => {
              const label = role === "curriculum_admin" ? t("curriculumAdmin") : plain;
              return (
                <label key={role} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={r.roles.includes(role)}
                    disabled={role === "platform_admin" && r.id === me}
                    onChange={(e) => patch(r, { roles: e.target.checked ? [...r.roles, role] : r.roles.filter((x) => x !== role) })}
                  />
                  {label}
                </label>
              );
              })}
            </fieldset>
          </li>
        ))}
        {!rows.length && <li className="p-4 text-sm text-muted">No one matches.</li>}
      </ul>
    </div>
  );
}
