"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CredentialCard } from "@/components/credentials/credential-card";
import { CredentialForm } from "@/components/credentials/credential-form";
import { Loading } from "@/components/loading";
import { RequireSession } from "@/lib/require-session";
import { Button } from "@/components/ui";
import { useNaming } from "@/lib/naming";
import { useAuth } from "@/lib/auth";
import type { Alert, Credential } from "@/lib/certs";
import type { Archive } from "@/lib/types";

function Credentials() {
  const { api } = useAuth();
  const { t } = useNaming();
  const [list, setList] = useState<Credential[] | null>(null);
  const [archives, setArchives] = useState<Archive[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, a] = await Promise.all([api<{ credentials: Credential[]; alerts: Alert[] }>("GET", "credentials"), api<{ archives: Archive[] }>("GET", "archives").catch(() => ({ archives: [] as Archive[] }))]);
      setList(c.credentials);
      setArchives(a.archives);
    } catch {
      setList([]);
      setError("Could not load your credentials.");
    }
  }, [api]);
  useEffect(() => void load(), [load]);

  if (list === null) return <Loading />;
  const groups: { title: string; items: Credential[] }[] = [
    { title: "Working toward", items: list.filter((c) => c.status === "planned" || c.status === "scheduled") },
    { title: "Earned", items: list.filter((c) => c.status === "earned") },
    { title: "Retired", items: list.filter((c) => c.status === "retired") },
  ].filter((g) => g.items.length);

  return (
    <div className="ulti-fade space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">{t("credentials")}</h1>
          <p className="text-sm text-muted">Exam dates, vouchers, renewals and continuing education hours, kept private to you.</p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden /> Add
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {adding && (
        <CredentialForm
          archives={archives}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {groups.length === 0 && !adding && (
        <div className="rounded-lg border border-dashed border-line p-10 text-center">
          <p className="mx-auto max-w-sm text-muted">Nothing tracked yet. Add the exam you are working toward, or a certification you already hold, and Ultimyr will remind you before dates arrive.</p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.title} aria-labelledby={`g-${g.title}`} className="space-y-3">
          <h2 id={`g-${g.title}`} className="text-xl">
            {g.title}
          </h2>
          <ul className="space-y-3">
            {g.items.map((c) => (
              <CredentialCard key={c.id} c={c} archives={archives} reload={load} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function CredentialsPage() {
  return (
    <RequireSession>
      <Credentials />
    </RequireSession>
  );
}
