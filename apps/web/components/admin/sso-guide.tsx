"use client";

import { useState } from "react";
import { Card } from "@/components/admin/bits";
import { CopyButton } from "@/components/admin/copy-button";
import { Button, Field } from "@/components/ui";
import { cleanBase } from "@/lib/scim-providers";
import { deriveSso, SSO_PROVIDERS, ssoUrls, validSlug, type Protocol, type SsoFill } from "@/lib/sso-providers";
import type { SsoSetup } from "@/lib/sso-setup";

const PROTOCOLS: Array<[Protocol, string]> = [["oidc", "OpenID Connect"], ["saml", "SAML 2.0"]];
const FILL_LABEL: Record<SsoFill, string> = { redirect: "Redirect address", acs: "ACS address", entity: "Entity ID", metadata: "Metadata address", issuer: "Issuer" };

export function SsoGuide({ origin, existing, setup, update, onPrefill }: { origin: string; existing: Array<{ slug: string; kind: string; enabled: boolean }>; setup: SsoSetup; update: (p: Partial<SsoSetup>) => void; onPrefill: () => void }) {
  const [open, setOpen] = useState(true);
  const saved = setup;
  const setSaved = (next: SsoSetup) => update(next);

  const provider = SSO_PROVIDERS.find((p) => p.id === saved.provider) ?? SSO_PROVIDERS[0]!;
  const protocol = saved.protocol;
  const slug = saved.slugs[provider.id] ?? provider.slug;
  const slugOk = validSlug(slug);
  const urls = slugOk ? ssoUrls(origin, slug) : null;
  const typed = saved.fields[provider.id] ?? {};
  const baseInput = typed.base ?? "";
  const providerBase = provider.id === "keycloak" ? (baseInput.trim() ? baseInput.trim() : null) : cleanBase(baseInput);
  const derived = deriveSso(provider.id, typed);
  const stepKey = `${provider.id}:${protocol}`;
  const done = new Set(saved.done[stepKey] ?? []);
  const live = existing.find((e) => e.slug === slug && (protocol === "saml" ? e.kind === "saml" : e.kind !== "saml") && e.enabled);

  const toggle = (i: number) => {
    const next = new Set(done);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSaved({ ...saved, done: { ...saved.done, [stepKey]: [...next] } });
  };
  const value = (f: SsoFill) => (urls ? { redirect: urls.redirect, acs: urls.acs, entity: urls.entity, metadata: urls.metadata, issuer: "" }[f] : "");

  if (!open) {
    return (
      <Card title="Setup guide" hint="Walk through connecting authentik, Okta, Microsoft Entra ID, Keycloak or another provider, with the addresses to copy and links to the right pages in the provider.">
        <Button onClick={() => setOpen(true)}>Start the guide</Button>
      </Card>
    );
  }

  return (
    <Card title="Setup guide" hint="Pick your provider and protocol, then follow the steps. Each step links to the matching page in the provider.">
      <div role="tablist" aria-label="Provider" className="flex flex-wrap gap-2">
        {SSO_PROVIDERS.map((p) => (
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
      <div role="tablist" aria-label="Protocol" className="flex flex-wrap gap-2">
        {PROTOCOLS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={id === protocol}
            onClick={() => setSaved({ ...saved, protocol: id })}
            className={`rounded-md border px-3 py-1 text-sm ${id === protocol ? "border-accent text-accent" : "border-line text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-sm">{provider.intro} {protocol === "oidc" ? "OpenID Connect is the simpler choice when your provider supports it." : "SAML sign-in always starts from Ultimyr."}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {provider.fields.map((f) => (
          <div key={`${provider.id}-${f.key}`}>
            <Field
              id={`sso-${f.key}`}
              label={f.label}
              placeholder={f.placeholder}
              value={typed[f.key] ?? ""}
              onChange={(e) => setSaved({ ...saved, fields: { ...saved.fields, [provider.id]: { ...typed, [f.key]: e.target.value } } })}
              inputMode={f.key === "base" ? "url" : "text"}
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-muted">{f.hint ?? "Used to work out the addresses and links below. Stored in this browser, not sent anywhere."}</p>
          </div>
        ))}
        <div>
          <Field
            id="sso-slug"
            label="Short name for this provider in Ultimyr"
            value={slug}
            onChange={(e) => setSaved({ ...saved, slugs: { ...saved.slugs, [provider.id]: e.target.value.toLowerCase() } })}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-muted">{slugOk ? "Part of the addresses below. Use the same one when you add the provider." : "Use 2 to 40 lowercase letters, digits or dashes, not starting or ending with a dash."}</p>
        </div>
      </div>
      {(derived.issuer || derived.entryPoint) && (
        <div className="space-y-1 rounded-md border border-accent p-3 text-sm" role="status">
          <p className="text-muted">Worked out from what you typed. These fill the Add a provider form below.</p>
          {protocol === "oidc" && derived.issuer && (
            <p className="flex flex-wrap items-center gap-2">
              Issuer: <code className="break-all">{derived.issuer}</code>
              <CopyButton text={derived.issuer} label="issuer" />
            </p>
          )}
          {protocol === "saml" && derived.entryPoint && (
            <p className="flex flex-wrap items-center gap-2">
              Sign-in URL: <code className="break-all">{derived.entryPoint}</code>
              <CopyButton text={derived.entryPoint} label="sign-in URL" />
            </p>
          )}
          {protocol === "saml" && !derived.entryPoint && <p className="text-xs text-muted">{provider.name} gives you the sign-in URL when you create the app, so you will paste it below.</p>}
        </div>
      )}
      <ol className="space-y-3">
        {provider.steps[protocol].map((s, i) => {
          const href = s.link?.href(providerBase) ?? null;
          return (
            <li key={`${stepKey}-${i}`} className="space-y-2 rounded-md border border-line p-4">
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={done.has(i)} onChange={() => toggle(i)} aria-label={`Mark step ${i + 1} done`} />
                <div className="flex-1 space-y-2">
                  <h3 className={`text-base ${done.has(i) ? "text-muted line-through" : ""}`}>
                    {i + 1}. {s.title}
                  </h3>
                  {s.menu && <p className="text-xs text-muted">Menu: {s.menu}</p>}
                  <p className="text-sm">{s.body}</p>
                  {s.copy?.map((f) => (
                    <div key={f} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted">{FILL_LABEL[f]}:</span>
                      {urls ? (
                        <>
                          <code className="break-all">{value(f)}</code>
                          <CopyButton text={value(f)} label={FILL_LABEL[f].toLowerCase()} />
                        </>
                      ) : (
                        <span className="text-xs text-muted">Fix the short name above first.</span>
                      )}
                    </div>
                  ))}
                  {s.link &&
                    (href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-accent underline">
                        {s.link.label} (opens in a new tab)
                      </a>
                    ) : (
                      <p className="text-xs text-muted">Enter your provider address above to get a direct link.</p>
                    ))}
                  {s.action === "prefill" && (
                    <Button disabled={!slugOk} onClick={onPrefill}>
                      Open the form with these values
                    </Button>
                  )}
                  {s.action === "test" &&
                    (live && urls ? (
                      <a href={urls.start[protocol]} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-accent underline">
                        Test sign-in with {live.slug} (opens in a new tab)
                      </a>
                    ) : (
                      <p className="text-xs text-muted">The test link appears here once an enabled {protocol === "saml" ? "SAML" : "OpenID Connect or OAuth 2"} provider named {slug} exists.</p>
                    ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <Button variant="quiet" onClick={() => setOpen(false)}>
        Hide the guide
      </Button>
    </Card>
  );
}
