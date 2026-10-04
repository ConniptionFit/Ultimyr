"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Meter } from "@/components/charts";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { formatDay, todayIso, type CeuEntry, type Credential } from "@/lib/certs";

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

/** The continuing education log for one credential, with progress toward what renewal needs. */
export function CeuLog({ credential, onChange }: { credential: Credential; onChange: () => void }) {
  const { api } = useAuth();
  const [entries, setEntries] = useState<CeuEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries((await api<Credential>("GET", `credentials/${credential.id}`)).entries ?? []);
    } catch {
      setError("Could not load the log.");
    }
  }, [api, credential.id]);
  useEffect(() => void load(), [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api("POST", `credentials/${credential.id}/ceu`, { title: String(f.get("title")).trim(), units: Number(f.get("units")), earnedOn: String(f.get("date")), category: String(f.get("category") ?? "").trim() });
      form.reset();
      setError(null);
      await load();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0] ?? err.code.replaceAll("_", " ")) : "Could not add that.");
    }
  }

  async function remove(id: string) {
    await api("DELETE", `credentials/${credential.id}/ceu/${id}`);
    await load();
    onChange();
  }

  const unit = credential.ceuUnit;
  const need = credential.ceuRequired;
  return (
    <div className="space-y-3">
      {need !== null && (
        <div className="space-y-1">
          <p className="text-sm">
            {num(credential.ceuLogged)} of {num(need)} {unit} logged this cycle
          </p>
          <Meter value={Math.min(10_000, (credential.ceuLogged / need) * 10_000)} label={`${unit} progress`} />
        </div>
      )}
      {entries === null ? null : entries.length === 0 ? (
        <p className="text-sm text-muted">Nothing logged yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {entries.map((en) => (
            <li key={en.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{en.title}</span>
                <span className="block text-xs text-muted">{[formatDay(en.earnedOn), en.category].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="tabular-nums">
                {num(en.units)} {unit}
              </span>
              <button aria-label={`Delete ${en.title}`} onClick={() => remove(en.id)} className="text-muted hover:text-danger">
                <Trash2 size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {need !== null && <p className="text-xs text-muted">Only entries dated between the day you earned it and the day it expires count toward the total.</p>}
      <form onSubmit={add} className="grid items-end gap-2 sm:grid-cols-[1fr_6rem_9rem_auto]">
        <Field id={`ceu-title-${credential.id}`} name="title" label="Activity" required maxLength={200} />
        <Field id={`ceu-units-${credential.id}`} name="units" type="number" min={0.01} step="0.01" label={unit} required />
        <Field id={`ceu-date-${credential.id}`} name="date" type="date" label="Date" defaultValue={todayIso()} required />
        <Button type="submit">Log</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
