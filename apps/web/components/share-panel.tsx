"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import type { Grant } from "@/lib/types";
import { useNaming } from "@/lib/naming";

const RELATIONS: { value: Grant["relation"]; label: string }[] = [
  { value: "viewer", label: "Can view" },
  { value: "editor", label: "Can edit" },
  { value: "owner", label: "Can edit and share" },
  { value: "attempt", label: "Can take quizzes only" },
];

/** Grant access to a person (by exact email) or a group. `base` is `archives/<id>` or `items/<id>`. */
export function SharePanel({ base }: { base: string }) {
  const { api } = useAuth();
  const { t } = useNaming();
  const [grants, setGrants] = useState<Grant[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGrants(await api<Grant[]>("GET", `${base}/grants`));
      setGroups(await api<{ id: string; name: string }[]>("GET", "groups"));
    } catch (e) {
      setError(e instanceof ApiError ? e.code.replaceAll("_", " ") : "Could not load sharing.");
    }
  }, [api, base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const who = String(f.get("who")).trim();
    const relation = String(f.get("relation"));
    setError(null);
    try {
      let subjectType: "user" | "group" = "user";
      let subjectId: string;
      const group = groups.find((g) => g.name.toLowerCase() === who.toLowerCase());
      if (group) {
        subjectType = "group";
        subjectId = group.id;
        setNames((n) => ({ ...n, [group.id]: group.name }));
      } else {
        const u = await api<{ id: string; displayName: string }>("GET", `users/lookup?email=${encodeURIComponent(who)}`);
        subjectId = u.id;
        setNames((n) => ({ ...n, [u.id]: u.displayName }));
      }
      await api("POST", `${base}/grants`, { subjectType, subjectId, relation });
      e.currentTarget.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "No active account with that email." : "Could not share. Check the details and try again.");
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-line p-4">
      <h2 className="text-lg">{t("share")}</h2>
      <ul className="divide-y divide-line text-sm">
        {grants.length === 0 && <li className="py-2 text-muted">Not shared with anyone.</li>}
        {grants.map((g) => (
          <li key={g.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              {names[g.subjectId] ?? groups.find((x) => x.id === g.subjectId)?.name ?? `${g.subjectType} ${g.subjectId.slice(0, 8)}`}{" "}
              <span className="text-muted">
                {g.subjectType === "group" ? "(group) " : ""}
                {RELATIONS.find((r) => r.value === g.relation)?.label.toLowerCase()}
              </span>
            </span>
            <Button
              variant="quiet"
              onClick={async () => {
                await api("DELETE", `${base}/grants/${g.id}`).catch(() => undefined);
                await load();
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1">
          <Field id="share-who" name="who" label="Email address, or pick a group" list="share-groups" required />
          <datalist id="share-groups">
            {groups.map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
        </div>
        <select name="relation" aria-label="Access level" className="rounded-md border border-line bg-surface px-3 py-2 text-ink">
          {RELATIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <Button type="submit">Share</Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
