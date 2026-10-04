"use client";

import { StatusIcon } from "@ultimyr/ui-icons";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Header } from "@/components/header";
import { Button, Shell } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { FIDELITY_LABEL, type Profile } from "@/lib/quiz";

const TEMPLATE = `{
  "name": "My profile",
  "fidelity": "custom",
  "rounding": "half_up",
  "types": { "multi": "penalty", "fib": "per_blank", "dnd": "per_item", "pbq": "weighted" },
  "negativeMarkingBp": 0,
  "pass": { "kind": "percent", "minBp": 7000 }
}`;

export default function ScoringPage() {
  const { state, api } = useAuth();
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [draft, setDraft] = useState(TEMPLATE);
  const [error, setError] = useState<string[]>([]);

  const load = useCallback(async () => setProfiles((await api<{ profiles: Profile[] }>("GET", "scoring-profiles")).profiles), [api]);
  useEffect(() => {
    if (state.status === "anonymous") router.replace("/login");
    if (state.status === "authenticated") void load();
  }, [state.status, router, load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError([]);
    let definition: unknown;
    try {
      definition = JSON.parse(draft);
    } catch {
      return setError(["That is not valid JSON."]);
    }
    try {
      await api("POST", "scoring-profiles", { definition });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues.length ? err.issues : [err.code.replaceAll("_", " ")]) : ["Something went wrong."]);
    }
  }

  return (
    <>
      <Header />
      <Shell>
        <div className="ulti-fade space-y-6">
          <h1 className="text-3xl">Scoring profiles</h1>
          <p className="text-muted">A profile says how answers become a score and a pass or fail. Profiles never change once saved: a new version is created instead, so old results stay exactly as they were. Vendors rarely publish their real formulas, so every profile says how closely it matches.</p>
          {!profiles ? (
            <StatusIcon status="loading" size={22} />
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {profiles.map((p) => (
                <li key={p.id} className="space-y-1 p-4">
                  <p className="font-medium">
                    {p.name} <span className="text-sm font-normal text-muted">v{p.version} · {FIDELITY_LABEL[p.fidelity]}{p.official ? " · built in" : ""}</span>
                  </p>
                  {p.source && <p className="text-sm text-muted">{p.source}</p>}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={create} className="space-y-3">
            <h2 className="text-xl">Save your own</h2>
            <label htmlFor="sp-def" className="text-sm text-muted">
              Definition (JSON). Saving under an existing name makes the next version.
            </label>
            <textarea id="sp-def" value={draft} onChange={(e) => setDraft(e.target.value)} rows={12} spellCheck={false} className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-sm text-ink" />
            {error.length > 0 && (
              <ul role="alert" className="text-sm text-danger">
                {error.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            <Button type="submit">Save profile</Button>
          </form>
        </div>
      </Shell>
    </>
  );
}
