"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/admin/bits";
import { Button, Field } from "@/components/ui";
import { cleanBase, curlCheck, SCIM_PROVIDERS, type Fill } from "@/lib/scim-providers";

const KEY = "ultimyr_scim_guide";

interface Saved { provider: string; bases: Record<string, string>; done: Record<string, number[]> }
const empty: Saved = { provider: "authentik", bases: {}, done: {} };

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<Saved>) } : empty;
  } catch {
    return empty;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant="quiet"
      className="px-3 py-1"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          setOk(false);
        }
      }}
    >
      {ok ? "Copied" : "Copy"}
    </Button>
  );
}

export function ScimGuide({ url, token, onCreateToken }: { url: string; token: string | null; onCreateToken: (name: string) => Promise<void> }) {
  const [saved, setSaved] = useState<Saved>(empty);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSaved(load());
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* private mode: the guide still works without remembering */
    }
  }, [saved, ready]);

  const provider = SCIM_PROVIDERS.find((p) => p.id === saved.provider) ?? SCIM_PROVIDERS[0]!;
  const baseInput = saved.bases[provider.id] ?? "";
  const providerBase = cleanBase(baseInput);
  const done = new Set(saved.done[provider.id] ?? []);
  const values: Record<Fill, string> = { url, token: token ?? "" };

  const toggle = (i: number) => {
    const next = new Set(done);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSaved({ ...saved, done: { ...saved.done, [provider.id]: [...next] } });
  };

  return (
    <Card title="Setup guide" hint="Pick your provider and follow the steps. Each step links to the matching page in the provider.">
      <div role="tablist" aria-label="Provider" className="flex flex-wrap gap-2">
        {SCIM_PROVIDERS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === provider.id}
            onClick={() => setSaved({ ...saved, provider: p.id })}
            className={`rounded-md border px-3 py-1 text-sm ${p.id === provider.id ? "border-accent text-accent" : "border-line text-muted"}`}
          >
            {p.name}
            {p.id === "authentik" && <span className="ml-1 text-xs">(default)</span>}
          </button>
        ))}
      </div>
      <p className="text-sm">{provider.intro}</p>
      {provider.warning && (
        <p role="note" className="rounded-md border border-danger p-3 text-sm">
          {provider.warning}
        </p>
      )}
      {provider.base && (
        <div>
          <Field
            id="scim-provider-base"
            label={provider.base.label}
            placeholder={provider.base.placeholder}
            value={baseInput}
            onChange={(e) => setSaved({ ...saved, bases: { ...saved.bases, [provider.id]: e.target.value } })}
            inputMode="url"
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-muted">Used only to build the links below. Stored in this browser, not sent anywhere.</p>
        </div>
      )}
      <ol className="space-y-3">
        {provider.steps.map((s, i) => {
          const href = s.link?.href(providerBase) ?? null;
          return (
            <li key={`${provider.id}-${i}`} className="space-y-2 rounded-md border border-line p-4">
              <div className="flex items-start gap-3">
                <input type="checkbox" id={`step-${i}`} className="mt-1" checked={done.has(i)} onChange={() => toggle(i)} aria-label={`Mark step ${i + 1} done`} />
                <div className="flex-1 space-y-2">
                  <h3 className={`text-base ${done.has(i) ? "text-muted line-through" : ""}`}>
                    {i + 1}. {s.title}
                  </h3>
                  {s.menu && <p className="text-xs text-muted">Menu: {s.menu}</p>}
                  <p className="text-sm">{s.body}</p>
                  {s.copy?.map((f) =>
                    f === "token" && !token ? (
                      <form
                        key={f}
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          setBusy(true);
                          try {
                            await onCreateToken(`${provider.name} provisioning`);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        <Button type="submit" disabled={busy}>
                          Generate token for {provider.name}
                        </Button>
                      </form>
                    ) : (
                      <div key={f} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted">{f === "url" ? "SCIM base address" : "Token"}:</span>
                        <code className="break-all">{values[f]}</code>
                        <CopyButton text={values[f]} label={f === "url" ? "address" : "token"} />
                      </div>
                    ),
                  )}
                  {s.link &&
                    (href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-accent underline">
                        {s.link.label} (opens in a new tab)
                      </a>
                    ) : (
                      <p className="text-xs text-muted">Enter your provider address above to get a direct link.</p>
                    ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <details className="text-sm">
        <summary className="cursor-pointer">Test from a terminal</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="break-all">{curlCheck(url)}</code>
          <CopyButton text={curlCheck(url)} label="command" />
        </div>
        <p className="mt-1 text-xs text-muted">A JSON answer means the address and token work.</p>
      </details>
    </Card>
  );
}
