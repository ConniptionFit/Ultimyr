"use client";

import { useEffect, useState } from "react";
import { ApiError, useAuth } from "@/lib/auth";
import { useObjectives, objectiveLabel } from "@/lib/objectives";

/** Tick the exam objectives a guide, deck or resource supports. Saves as you go. Renders nothing until the archive has objectives. */
export function ObjectivePicker({ archiveId, kind, refId }: { archiveId: string; kind: "item" | "card" | "resource"; refId: string }) {
  const { api } = useAuth();
  const { tree } = useObjectives(archiveId);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ objectiveIds: string[] }>("GET", `archives/${archiveId}/links?kind=${kind}&refId=${refId}`)
      .then((r) => setChosen(r.objectiveIds))
      .catch(() => setChosen([]));
  }, [api, archiveId, kind, refId]);

  if (!tree?.length || chosen === null) return null;

  async function toggle(id: string, on: boolean) {
    const next = on ? [...chosen!, id] : chosen!.filter((x) => x !== id);
    const before = chosen;
    setChosen(next);
    setError(null);
    try {
      await api("PUT", `archives/${archiveId}/links`, { kind, refId, objectiveIds: next });
    } catch (e) {
      setChosen(before);
      setError(e instanceof ApiError ? (e.issues[0] ?? e.code.replaceAll("_", " ")) : "Could not save.");
    }
  }

  return (
    <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer text-sm">
        Exam objectives <span className="text-muted">({chosen.length} linked)</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted">Say which objectives this supports. The coverage map uses it to show what is well covered and what is not.</p>
        {tree.map((d) => (
          <fieldset key={d.id} className="space-y-1">
            <legend className="text-sm font-medium">{objectiveLabel(d)}</legend>
            {[...(d.children?.length ? d.children : [d])].map((o) => (
              <label key={o.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={chosen.includes(o.id)} onChange={(e) => toggle(o.id, e.target.checked)} />
                <span>{objectiveLabel(o)}</span>
              </label>
            ))}
          </fieldset>
        ))}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
