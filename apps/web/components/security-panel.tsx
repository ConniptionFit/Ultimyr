"use client";

import { startRegistration } from "@simplewebauthn/browser";
import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";

interface MfaState {
  totp: { enabled: boolean };
  passkeys: number;
  recoveryCodesRemaining: number;
  hasPassword: boolean;
}
interface Passkey { id: string; name: string; backedUp: boolean; createdAt: string; lastUsedAt: string | null }
interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null }
interface SessionRow { id: string; current: boolean; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string | null }

const SCOPE_CHOICES = ["content:read", "content:write", "content:share", "quiz:read", "quiz:write", "ai:use", "notes:use"];
const when = (v: string | null) => (v ? new Date(v).toLocaleString() : "never");
const message = (e: unknown) => (e instanceof ApiError ? e.issues[0] ?? e.code.replaceAll("_", " ") : "Could not reach the server.");

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl">{title}</h2>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function SecurityPanel() {
  const { api } = useAuth();
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, p, k, s] = await Promise.all([
        api<MfaState>("GET", "me/mfa"),
        api<Passkey[]>("GET", "me/passkeys"),
        api<ApiKey[]>("GET", "me/api-keys"),
        api<SessionRow[]>("GET", "me/sessions"),
      ]);
      setMfa(m);
      setPasskeys(p);
      setKeys(k);
      setSessions(s);
    } catch (e) {
      setError(message(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = (fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(message(e));
    }
  };

  const startTotp = run(async () => {
    const { secret, otpauthUri } = await api<{ secret: string; otpauthUri: string }>("POST", "me/mfa/totp/setup");
    setSetup({ secret, qr: await QRCode.toDataURL(otpauthUri, { margin: 1, width: 192 }) });
  });

  async function confirmTotp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code"));
    await run(async () => {
      const r = await api<{ recoveryCodes: string[] }>("POST", "me/mfa/totp/confirm", { code });
      setCodes(r.recoveryCodes);
      setSetup(null);
    })();
  }

  async function disableTotp(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { password: String(f.get("password") ?? "") || undefined, code: String(f.get("code") ?? "") || undefined };
    await run(async () => {
      await api("DELETE", "me/mfa/totp", body);
    })();
  }

  const addPasskey = run(async () => {
    const o = await api<{ challengeId: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("POST", "me/passkeys/register/options");
    const response = await startRegistration({ optionsJSON: o.options });
    const name = window.prompt("Name this passkey", "This device")?.trim() || "Passkey";
    await api("POST", "me/passkeys/register/verify", { challengeId: o.challengeId, name, response });
  });

  async function createKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const scopes = f.getAll("scope").map(String);
    const days = Number(f.get("days"));
    await run(async () => {
      const r = await api<{ key: string }>("POST", "me/api-keys", { name: String(f.get("name")), scopes, ...(days ? { expiresInDays: days } : {}) });
      setNewKey(r.key);
    })();
  }

  if (!mfa) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : null;

  return (
    <div className="space-y-10">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <Section title="Authenticator app" hint="A 6 digit code from an app such as 1Password, Aegis or Google Authenticator.">
        {mfa.totp.enabled ? (
          <form onSubmit={disableTotp} className="space-y-3">
            <p className="text-sm">Enabled. {mfa.recoveryCodesRemaining} recovery codes remaining.</p>
            {mfa.hasPassword ? <Field id="dis-pw" name="password" type="password" label="Password (to turn it off)" autoComplete="current-password" /> : <Field id="dis-code" name="code" label="Authenticator code (to turn it off)" inputMode="numeric" />}
            <div className="flex gap-2">
              <Button type="submit" variant="quiet">Turn off</Button>
              <Button type="button" variant="quiet" onClick={run(async () => setCodes((await api<{ recoveryCodes: string[] }>("POST", "me/mfa/recovery-codes/regenerate")).recoveryCodes))}>
                New recovery codes
              </Button>
            </div>
          </form>
        ) : setup ? (
          <form onSubmit={confirmTotp} className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} width={192} height={192} alt="QR code for your authenticator app" className="rounded-md border border-line bg-white" />
            <p className="text-sm text-muted">
              Or enter this key by hand: <code className="select-all break-all">{setup.secret}</code>
            </p>
            <Field id="totp-code" name="code" label="Code from the app" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" />
            <Button type="submit">Confirm and turn on</Button>
          </form>
        ) : (
          <Button onClick={startTotp}>Set up</Button>
        )}
        {codes && (
          <div className="space-y-2 rounded-md border border-line p-4">
            <p className="text-sm">Save these recovery codes now. Each works once and they are not shown again.</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {codes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <Button variant="quiet" onClick={() => setCodes(null)}>I have saved them</Button>
          </div>
        )}
      </Section>

      <Section title="Passkeys" hint="Sign in with your device, fingerprint or security key. No password needed.">
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {passkeys.length === 0 && <li className="p-3 text-muted">No passkeys yet.</li>}
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 p-3">
              <span>
                {p.name} <span className="text-muted">last used {when(p.lastUsedAt)}</span>
              </span>
              <Button variant="quiet" onClick={run(() => api("DELETE", `me/passkeys/${p.id}`))}>Remove</Button>
            </li>
          ))}
        </ul>
        <Button onClick={addPasskey}>Add a passkey</Button>
      </Section>

      <Section title="API keys" hint="For scripts and MCP clients. A key only gets the scopes you pick, and cannot change your account.">
        {newKey && (
          <div className="space-y-2 rounded-md border border-line p-4">
            <p className="text-sm">Copy this key now. It is not shown again.</p>
            <code className="block select-all break-all text-sm">{newKey}</code>
            <Button variant="quiet" onClick={() => setNewKey(null)}>Done</Button>
          </div>
        )}
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {keys.filter((k) => !k.revokedAt).length === 0 && <li className="p-3 text-muted">No active keys.</li>}
          {keys.filter((k) => !k.revokedAt).map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 p-3">
              <span>
                {k.name} <code className="text-muted">{k.prefix}…</code>
                <span className="block text-muted">{k.scopes.join(", ")} · last used {when(k.lastUsedAt)}</span>
              </span>
              <Button variant="quiet" onClick={run(() => api("DELETE", `me/api-keys/${k.id}`))}>Revoke</Button>
            </li>
          ))}
        </ul>
        <form onSubmit={createKey} className="space-y-3">
          <Field id="key-name" name="name" label="Key name" required maxLength={60} />
          <fieldset className="space-y-1 text-sm">
            <legend className="text-muted">Scopes</legend>
            {SCOPE_CHOICES.map((s) => (
              <label key={s} className="mr-4 inline-flex items-center gap-1">
                <input type="checkbox" name="scope" value={s} defaultChecked={s.endsWith(":read")} /> {s}
              </label>
            ))}
          </fieldset>
          <Field id="key-days" name="days" type="number" label="Expires in days (blank for never)" min={1} max={365} />
          <Button type="submit">Create key</Button>
        </form>
      </Section>

      <Section title="Signed-in devices" hint="Lost a phone or used a shared computer? Sign out everywhere else and keep this device.">
        {sessions.some((s) => !s.current) && (
          <div>
            <Button variant="quiet" onClick={run(() => api("DELETE", "me/sessions"))}>
              Sign out all other devices
            </Button>
          </div>
        )}
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 p-3">
              <span>
                {s.userAgent?.slice(0, 60) ?? "Unknown device"} {s.current && <strong>(this one)</strong>}
                <span className="block text-muted">{s.ip ?? "unknown IP"} · since {when(s.createdAt)}</span>
              </span>
              {!s.current && <Button variant="quiet" onClick={run(() => api("DELETE", `me/sessions/${s.id}`))}>Sign out</Button>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
