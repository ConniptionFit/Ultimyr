"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, ErrorLine, Stat } from "@/components/admin/bits";
import { Button, Toggle } from "@/components/ui";
import { message } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

interface Overview {
  users: { total: number; active: number; suspended: number };
  admins: number;
  groups: number;
  signInProviders: number;
  deployment: { publicUrl: string; environment: string };
  settings: { registrationOpen: boolean; registrationOverridden: boolean; registrationDefault: boolean };
}

interface ServiceRow { name: string; ok: boolean; ms: number; problem?: string }

export default function General() {
  const { api } = useAuth();
  const { t } = useNaming();
  const [services, setServices] = useState<ServiceRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const checkServices = useCallback(async () => {
    setChecking(true);
    try {
      setServices(await api<ServiceRow[]>("GET", "admin/services"));
    } catch {
      setServices(null);
    } finally {
      setChecking(false);
    }
  }, [api]);
  useEffect(() => {
    void checkServices();
  }, [checkServices]);
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setO(await api<Overview>("GET", "admin/overview"));
    } catch (e) {
      setError(message(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function setRegistration(registrationOpen: boolean | null) {
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", "admin/settings", { registrationOpen });
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (!o) return error ? <ErrorLine error={error} /> : <p className="text-sm text-muted">Loading.</p>;
  const s = o.settings;
  return (
    <div className="space-y-6">
      <h2 className="text-2xl">General</h2>
      <ErrorLine error={error} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="People" value={o.users.total} />
        <Stat label="Administrators" value={o.admins} />
        <Stat label="Groups" value={o.groups} />
        <Stat label="Sign-in providers on" value={o.signInProviders} />
      </div>
      {o.users.suspended > 0 && <p className="text-sm text-muted">{o.users.suspended} suspended.</p>}

      <Card title="Registration" hint="Who can create an account. The first account on a new install is always allowed, and becomes the administrator.">
        <Toggle label="Allow new sign-ups" hint="Turn off to make Ultimyr invite or directory only (SSO and SCIM still create accounts)." on={s.registrationOpen} disabled={busy} onChange={(v) => setRegistration(v)} />
        <p className="flex items-center gap-2 text-xs text-muted">
          {s.registrationOverridden ? <Badge tone="accent">Set here</Badge> : <Badge>Install default</Badge>}
          The install default is {s.registrationDefault ? "open" : "closed"} (AUTH_REGISTRATION).
          {s.registrationOverridden && (
            <Button variant="quiet" className="px-2 py-0.5 text-xs" disabled={busy} onClick={() => setRegistration(null)}>
              Use the default
            </Button>
          )}
        </p>
      </Card>

      <Card title={t("services")} hint="Whether each part of Ultimyr answers its health check. Anything red usually means its container is stopped or its database is unreachable: run docker compose logs <name>.">
        {services ? (
          <ul className="space-y-1 text-sm">
            {services.map((x) => (
              <li key={x.name} className="flex flex-wrap items-center gap-2">
                <Badge tone={x.ok ? "accent" : undefined}>{x.ok ? "Running" : "Not ready"}</Badge>
                <span>{x.name}</span>
                {x.ok && x.ms > 0 && <span className="text-xs text-muted">{x.ms} ms</span>}
                {x.problem && <span className="text-xs text-muted">{x.problem}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{checking ? "Checking." : "Could not check."}</p>
        )}
        <Button variant="quiet" className="px-2 py-0.5 text-xs" disabled={checking} onClick={() => void checkServices()}>
          Check again
        </Button>
      </Card>

      <Card title="This installation" hint="Set in the environment when Ultimyr is deployed. See docs/configuration.md.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">Public address</dt>
          <dd className="break-all">{o.deployment.publicUrl}</dd>
          <dt className="text-muted">Environment</dt>
          <dd>{o.deployment.environment}</dd>
        </dl>
      </Card>
    </div>
  );
}
