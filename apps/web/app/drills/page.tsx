"use client";

import { Dumbbell } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Loading } from "@/components/loading";
import { RequireSession } from "@/lib/require-session";
import { Button } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { FOCUS_LABEL, type DrillFocus } from "@/lib/certs";
import { useNaming } from "@/lib/naming";
import type { Analytics } from "@/lib/progress";
import { pct } from "@/lib/quiz";
import type { Archive } from "@/lib/types";

const input = "w-full rounded-md border border-line bg-surface px-3 py-2 text-ink";

const ERRORS: Record<string, string> = {
  no_questions: "There are no published practice questions in that course yet.",
  nothing_to_drill: "Nothing to redo: you did not miss anything last time. Try the Mixed drill instead.",
  not_found: "That course could not be found.",
};

function Drills() {
  const { api } = useAuth();
  const { t } = useNaming();
  const router = useRouter();
  const params = useSearchParams();
  const [archives, setArchives] = useState<Archive[] | null>(null);
  const [archive, setArchive] = useState(params.get("archive") ?? "");
  const [focus, setFocus] = useState<DrillFocus>(() => (["mixed", "weak", "missed"].includes(params.get("focus") ?? "") ? (params.get("focus") as DrillFocus) : "mixed"));
  const [count, setCount] = useState(15);
  const [weak, setWeak] = useState<Analytics["weak"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ archives: Archive[] }>("GET", "archives")
      .then((r) => {
        setArchives(r.archives);
        setArchive((cur) => cur || r.archives[0]?.id || "");
      })
      .catch(() => setArchives([]));
  }, [api]);
  useEffect(() => {
    if (!archive) return;
    api<Analytics>("GET", `analytics?archive=${archive}&days=90`)
      .then((a) => setWeak(a.weak))
      .catch(() => setWeak([]));
  }, [api, archive]);

  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await api<{ id: string }>("POST", "drills", { archiveId: archive, focus, count });
      router.push(`/attempts/${a.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (ERRORS[err.code] ?? "Could not start a drill.") : "Could not start a drill.");
      setBusy(false);
    }
  }

  if (!archives) return <Loading />;
  return (
    <div className="ulti-fade max-w-xl space-y-8">
      <div>
        <h1 className="flex items-center gap-2 text-3xl">
          <Dumbbell aria-hidden /> {t("drills")}
        </h1>
        <p className="mt-1 text-sm text-muted">A short practice set built from the questions you miss most, with instant feedback. Drills do not count toward your readiness estimate.</p>
      </div>
      {archives.length === 0 ? (
        <p className="text-muted">You have no {t("archives").toLowerCase()} yet.</p>
      ) : (
        <form onSubmit={start} className="space-y-5">
          <div className="space-y-1">
            <label htmlFor="d-archive" className="text-sm text-muted">
              {t("archive")}
            </label>
            <select id="d-archive" value={archive} onChange={(e) => setArchive(e.target.value)} className={input}>
              {archives.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm text-muted">What to drill</legend>
            {(Object.keys(FOCUS_LABEL) as DrillFocus[]).map((k) => (
              <label key={k} className="flex items-start gap-2 rounded-md border border-line p-3 has-[:checked]:border-accent">
                <input type="radio" name="focus" className="mt-1" checked={focus === k} onChange={() => setFocus(k)} />
                <span>
                  <span className="block text-sm">{FOCUS_LABEL[k].name}</span>
                  <span className="block text-xs text-muted">{FOCUS_LABEL[k].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <label htmlFor="d-count" className="text-sm text-muted">
              Questions
            </label>
            <select id="d-count" value={count} onChange={(e) => setCount(Number(e.target.value))} className={input}>
              {[10, 15, 25, 40].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          {weak.length > 0 && (
            <p className="text-sm text-muted">
              Weakest topics lately: {weak.map((w) => `${w.domain} (${pct(w.accuracyBp)})`).join(", ")}.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !archive}>
            Start drill
          </Button>
        </form>
      )}
    </div>
  );
}

export default function DrillsPage() {
  return (
    <RequireSession>
      <Suspense fallback={<Loading />}>
        <Drills />
      </Suspense>
    </RequireSession>
  );
}
