"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, ErrorLine } from "@/components/admin/bits";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui";
import { message, when } from "@/lib/admin";
import { useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

interface About {
  name: string;
  repo: { name: string; url: string };
  build: { version: string; commit: string; builtAt: string | null; commitUrl: string | null };
  update: {
    status: "current" | "behind" | "unknown" | "disabled";
    checkedAt: string | null;
    latest: { version: string; url: string; publishedAt: string | null } | null;
    newRelease: boolean;
    commitsBehind: number | null;
    reason: string | null;
  };
  changelog: { title: string; body: string } | null;
  links: Record<"repo" | "docs" | "changelog" | "issues" | "security" | "license" | "releases", string>;
  license: string;
}
interface Overview {
  deployment: { publicUrl: string; environment: string };
}

const ext = { target: "_blank", rel: "noopener noreferrer", className: "text-accent underline" } as const;

export default function AboutThisApp() {
  const { api } = useAuth();
  const { t } = useNaming();
  const [a, setA] = useState<About | null>(null);
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      setBusy(true);
      try {
        setA(await api<About>("GET", `admin/about${refresh ? "?refresh=1" : ""}`));
        setError(null);
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
    },
    [api],
  );
  useEffect(() => {
    void load(false);
    api<Overview>("GET", "admin/overview").then(setO, () => {});
  }, [api, load]);

  if (!a) return error ? <ErrorLine error={error} /> : <p className="text-sm text-muted">Loading.</p>;
  const u = a.update;
  const short = a.build.commit.slice(0, 7);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl">{t("about")}</h2>
      <ErrorLine error={error} />

      <Card title={a.name} hint="Learning and certification study, self-hosted.">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted">Repository</dt>
          <dd>
            <a href={a.repo.url} {...ext}>
              {a.repo.name}
            </a>
          </dd>
          <dt className="text-muted">Current version</dt>
          <dd>
            {a.build.version}
            {short && (
              <>
                {" "}
                (
                {a.build.commitUrl ? (
                  <a href={a.build.commitUrl} {...ext}>
                    {short}
                  </a>
                ) : (
                  short
                )}
                )
              </>
            )}
          </dd>
          {a.build.builtAt && (
            <>
              <dt className="text-muted">Built</dt>
              <dd>{when(a.build.builtAt)}</dd>
            </>
          )}
          <dt className="text-muted">License</dt>
          <dd>
            <a href={a.links.license} {...ext}>
              {a.license}
            </a>
          </dd>
        </dl>
      </Card>

      <Card title="Updates">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {u.status === "current" && <Badge tone="accent">Up to date</Badge>}
          {u.status === "behind" && <Badge tone="danger">Update available</Badge>}
          {u.status === "unknown" && <Badge>Could not check</Badge>}
          {u.status === "disabled" && <Badge>Checks off</Badge>}
          {u.status === "current" && <span>You are on the latest version.</span>}
          {u.status === "behind" && (
            <span>
              {u.newRelease && u.latest
                ? `Version ${u.latest.version} is out.`
                : `${u.commitsBehind} newer ${u.commitsBehind === 1 ? "change is" : "changes are"} on the main branch.`}
            </span>
          )}
          {(u.status === "unknown" || u.status === "disabled") && <span className="text-muted">{u.reason}</span>}
        </p>
        {u.latest && (
          <p className="text-sm">
            Latest release:{" "}
            <a href={u.latest.url} {...ext}>
              {u.latest.version}
            </a>
            {u.latest.publishedAt && <span className="text-muted"> ({when(u.latest.publishedAt)})</span>}
          </p>
        )}
        {u.status === "behind" && (
          <p className="text-sm text-muted">
            To update, run <code className="rounded bg-surface px-1 py-0.5">git pull &amp;&amp; docker compose up -d --build</code> on the server.
          </p>
        )}
        <div className="flex items-center gap-3">
          {u.status !== "disabled" && (
            <Button variant="quiet" disabled={busy} onClick={() => load(true)}>
              {busy ? "Checking." : "Check again"}
            </Button>
          )}
          {u.checkedAt && <span className="text-xs text-muted">Last checked {when(u.checkedAt)}</span>}
        </div>
      </Card>

      {a.changelog && (
        <Card title="What is new" hint={a.changelog.title}>
          <Markdown>{a.changelog.body}</Markdown>
          <a href={a.links.changelog} {...ext} className="text-sm text-accent underline">
            Full changelog
          </a>
        </Card>
      )}

      <Card title="Help and links">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <a href={a.links.docs} {...ext}>
              Documentation
            </a>
          </li>
          <li>
            <a href={a.links.releases} {...ext}>
              Releases
            </a>
          </li>
          <li>
            <a href={a.links.issues} {...ext}>
              Report a problem or request a feature
            </a>
          </li>
          <li>
            <a href={a.links.security} {...ext}>
              Report a security vulnerability privately
            </a>
          </li>
        </ul>
      </Card>

      {o && (
        <Card title="This installation" hint="Set in the environment when Ultimyr is deployed.">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Public address</dt>
            <dd className="break-all">{o.deployment.publicUrl}</dd>
            <dt className="text-muted">Environment</dt>
            <dd>{o.deployment.environment}</dd>
          </dl>
        </Card>
      )}
    </div>
  );
}
