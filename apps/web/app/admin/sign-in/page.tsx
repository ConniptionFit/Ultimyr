"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, ErrorLine, selectCls } from "@/components/admin/bits";
import { Button, Field, Toggle } from "@/components/ui";
import { message } from "@/lib/admin";
import { useAuth } from "@/lib/auth";

interface Provider {
  id: string;
  slug: string;
  kind: "oidc" | "oauth2" | "saml";
  name: string;
  jitProvisioning: boolean;
  trustEmail: boolean;
  enabled: boolean;
  hasClientSecret: boolean;
  redirectUri: string;
  metadataUrl?: string;
}
type Kind = Provider["kind"];

/** Fields per provider kind: [config key, label, input type, required]. */
const FIELDS: Record<Kind, Array<[string, string, string, boolean]>> = {
  oidc: [["issuer", "Issuer URL", "url", true], ["clientId", "Client ID", "text", true]],
  oauth2: [
    ["authorizeUrl", "Authorize URL", "url", true],
    ["tokenUrl", "Token URL", "url", true],
    ["userinfoUrl", "User info URL", "url", true],
    ["clientId", "Client ID", "text", true],
  ],
  saml: [["entryPoint", "Sign-in URL (SSO entry point)", "url", true], ["idpCert", "Identity provider certificate (PEM)", "text", true]],
};
const KIND_LABEL: Record<Kind, string> = { oidc: "OpenID Connect", oauth2: "OAuth 2", saml: "SAML" };

export default function SignIn() {
  const { api } = useAuth();
  const [list, setList] = useState<Provider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<Kind>("oidc");
  const [localOff, setLocalOff] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api<Provider[]>("GET", "admin/idp-providers"));
      setLocalOff((await api<{ localUsersDisabled: boolean }>("GET", "admin/settings")).localUsersDisabled);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(message(e) === "slug taken" ? "That short name is taken." : message(e) === "no identity provider" ? "Add and enable a single sign-on provider first, so people still have a way in." : message(e));
      return false;
    }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const config: Record<string, string> = {};
    for (const [key] of FIELDS[kind]) config[key] = String(f.get(key) ?? "").trim();
    const secret = String(f.get("clientSecret") ?? "").trim();
    const ok = await run(() =>
      api("POST", "admin/idp-providers", {
        kind,
        slug: String(f.get("slug")),
        name: String(f.get("name")).trim(),
        config,
        jitProvisioning: f.get("jit") === "on",
        trustEmail: f.get("trust") === "on",
        ...(secret ? { clientSecret: secret } : {}),
      }),
    );
    if (ok) setAdding(false);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl">Sign-in methods</h2>
      <p className="text-sm text-muted">Passwords, passkeys and authenticator codes are always available. Add single sign-on so people can use your identity provider. See docs/identity.md.</p>
      <ErrorLine error={error} />
      <section className="space-y-2 rounded-md border border-line p-5">
        <h3 className="text-lg">Local accounts</h3>
        <Toggle
          label="Disable local accounts"
          hint="Turns off password, passkey and sign-up access for anyone who does not come from single sign-on or SCIM, and blocks manual account creation. Needs an enabled provider."
          on={localOff}
          onChange={(v) => run(() => api("PATCH", "admin/settings", { localUsersDisabled: v }))}
        />
        <p className="text-xs text-muted">Local administrators can always still sign in, as a break-glass way back in if your provider is down. Off by default.</p>
      </section>
      <ul className="divide-y divide-line rounded-md border border-line">
        {list.map((p) => (
          <li key={p.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {p.name} <span className="text-xs text-muted">/{p.slug}</span>
              </p>
              <div className="flex items-center gap-2">
                <Badge>{KIND_LABEL[p.kind]}</Badge>
                <Button variant="quiet" className="px-3 py-1" onClick={() => confirm(`Delete ${p.name}? People who signed in with it keep their accounts.`) && run(() => api("DELETE", `admin/idp-providers/${p.id}`))}>
                  Delete
                </Button>
              </div>
            </div>
            <Toggle label="Enabled" on={p.enabled} onChange={(enabled) => run(() => api("PATCH", `admin/idp-providers/${p.id}`, { enabled }))} />
            <Toggle label="Create accounts on first sign-in" hint="Just-in-time provisioning." on={p.jitProvisioning} onChange={(jitProvisioning) => run(() => api("PATCH", `admin/idp-providers/${p.id}`, { jitProvisioning }))} />
            <Toggle label="Trust the provider's email" hint="Only for providers that verify email addresses." on={p.trustEmail} onChange={(trustEmail) => run(() => api("PATCH", `admin/idp-providers/${p.id}`, { trustEmail }))} />
            <p className="break-all text-xs text-muted">
              {p.kind === "saml" ? "ACS URL" : "Redirect URI"}: {p.redirectUri}
              {p.metadataUrl && <> · Metadata: {p.metadataUrl}</>}
            </p>
          </li>
        ))}
        {!list.length && <li className="p-4 text-sm text-muted">No single sign-on providers yet.</li>}
      </ul>

      {!adding ? (
        <Button onClick={() => setAdding(true)}>Add a provider</Button>
      ) : (
        <form onSubmit={create} className="space-y-3 rounded-md border border-line p-5">
          <h3 className="text-lg">New provider</h3>
          <label className="block space-y-1 text-sm text-muted">
            Type
            <select className={`${selectCls} block`} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <Field id="p-name" name="name" label="Button label" required maxLength={60} />
          <Field id="p-slug" name="slug" label="Short name (lowercase, used in the address)" required pattern="[a-z0-9][a-z0-9\-]{0,38}[a-z0-9]" />
          {FIELDS[kind].map(([key, label, type, required]) => (
            <Field key={`${kind}-${key}`} id={`p-${key}`} name={key} label={label} type={type} required={required} />
          ))}
          {kind !== "saml" && <Field id="p-secret" name="clientSecret" label="Client secret (stored encrypted, never shown again)" type="password" autoComplete="off" />}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="jit" defaultChecked /> Create accounts on first sign-in
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="trust" /> Trust the provider&apos;s email addresses
          </label>
          <div className="flex gap-2">
            <Button type="submit">Add provider</Button>
            <Button type="button" variant="quiet" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
