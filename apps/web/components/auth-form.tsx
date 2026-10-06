"use client";

import { StatusIcon, type Status } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { takeReturn } from "@/lib/after-login";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";
import { fallbackError } from "@/lib/auth-errors";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { state, signIn, changePassword, register, verifyMfa, signInWithPasskey } = useAuth();
  const { copy } = useNaming();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [change, setChange] = useState<{ token: string; current: string } | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [providers, setProviders] = useState<{ slug: string; name: string; startUrl: string }[]>([]);

  // Someone who already has a session should never be shown the form (for example after following the logo).
  const alreadySignedIn = state.status === "authenticated" && status === "idle" && !mfaToken && !change;
  useEffect(() => {
    if (alreadySignedIn) router.replace(takeReturn() ?? "/reading-room");
  }, [alreadySignedIn, router]);

  useEffect(() => {
    if (mode !== "login") return;
    fetch("/api/v1/auth/sso/providers")
      .then((r) => (r.ok ? r.json() : []))
      .then(setProviders)
      .catch(() => undefined);
    const e = new URLSearchParams(window.location.search).get("error");
    if (e) setError(ssoMessage(e));
  }, [mode]);

  async function onPasskey() {
    setStatus("loading");
    setError(null);
    try {
      await signInWithPasskey();
      setStatus("success");
      router.push(takeReturn() ?? "/reading-room");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? "That passkey was not recognised." : "Passkey sign-in was cancelled or is not available here.");
    }
  }

  async function onMfa(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!mfaToken) return;
    const v = String(new FormData(e.currentTarget).get("code")).trim();
    setStatus("loading");
    setError(null);
    try {
      await verifyMfa(mfaToken, useRecovery ? { recoveryCode: v } : { code: v });
      setStatus("success");
      router.push(takeReturn() ?? "/reading-room");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError && err.code === "invalid_code" ? "That code did not work." : err instanceof ApiError && err.status === 401 ? "This sign-in expired. Start again." : fallbackError(err));
    }
  }

  async function onChange(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!change) return;
    const f = new FormData(e.currentTarget);
    const next = String(f.get("newPassword"));
    if (next !== String(f.get("confirm"))) {
      setStatus("error");
      setError("The two passwords do not match.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      await changePassword(change.token, change.current, next);
      setStatus("success");
      router.push(takeReturn() ?? "/reading-room");
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError && err.code === "password_unchanged") setError("Choose a different password from the temporary one.");
      else if (err instanceof ApiError && err.code === "invalid_request") setError(err.issues[0] ?? "Please check the password and try again.");
      else if (err instanceof ApiError && err.status === 401) setError("This step expired. Sign in again.");
      else setError(fallbackError(err));
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setStatus("loading");
    setError(null);
    try {
      if (mode === "login") {
        const next = await signIn(email, password);
        if (next && "changeToken" in next) {
          setChange({ token: next.changeToken, current: password });
          setStatus("idle");
          return;
        }
        if (next) {
          setMfaToken(next.mfaToken);
          setStatus("idle");
          return;
        }
      } else await register(String(f.get("displayName")), email, password);
      setStatus("success");
      router.push(takeReturn() ?? "/reading-room");
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError) {
        if (err.code === "invalid_credentials") setError(copy("loginError"));
        else if (err.code === "email_taken") setError("That email already has an account.");
        else if (err.code === "local_users_disabled") setError(mode === "login" ? "Password sign-in is turned off here. Use single sign-on, or ask an administrator." : "Accounts on this installation come from single sign-on. Ask an administrator.");
        else if (err.code === "registration_closed") setError("Registration is closed on this installation. Ask an administrator for an invitation.");
        else if (err.code === "invalid_request") setError(err.issues[0] ?? "Please check the details and try again.");
        else setError(fallbackError(err));
      } else setError("Could not reach the server.");
    }
  }

  const isLogin = mode === "login";
  if (change) {
    return (
      <form onSubmit={onChange} className="ulti-fade space-y-5">
        <h1 className="text-3xl">Choose a new password</h1>
        <p className="text-sm text-muted">An administrator gave you a temporary password. Pick your own to continue.</p>
        <Field id="newPassword" name="newPassword" type="password" label="New password (12 characters or more)" autoComplete="new-password" autoFocus required minLength={12} />
        <Field id="confirm" name="confirm" type="password" label="Repeat the new password" autoComplete="new-password" required minLength={12} />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={status === "loading"} className="w-full">
          Save and sign in
          <StatusIcon status={status} size={16} />
        </Button>
      </form>
    );
  }
  if (mfaToken) {
    return (
      <form onSubmit={onMfa} className="ulti-fade space-y-5">
        <h1 className="text-3xl">Second step</h1>
        <Field
          id="code"
          name="code"
          label={useRecovery ? "Recovery code" : "6 digit code from your authenticator"}
          inputMode={useRecovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoFocus
          required
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={status === "loading"} className="w-full">
          Verify
          <StatusIcon status={status} size={16} />
        </Button>
        <button type="button" className="w-full text-center text-sm text-accent underline" onClick={() => { setUseRecovery(!useRecovery); setError(null); }}>
          {useRecovery ? "Use an authenticator code instead" : "Use a recovery code"}
        </button>
      </form>
    );
  }
  return (
    <form onSubmit={onSubmit} className="ulti-fade space-y-5">
      <h1 className="text-3xl">{copy(isLogin ? "loginTitle" : "registerTitle")}</h1>
      {!isLogin && <Field id="displayName" name="displayName" label="Name" autoComplete="name" required maxLength={80} />}
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required />
      <Field
        id="password"
        name="password"
        type="password"
        label={isLogin ? "Password" : "Password (12 characters or more)"}
        autoComplete={isLogin ? "current-password" : "new-password"}
        required
        minLength={isLogin ? undefined : 12}
      />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={status === "loading"} className="w-full">
        {status === "loading" ? copy("signingIn") : isLogin ? "Sign in" : "Create account"}
        <StatusIcon status={status} size={16} />
      </Button>
      {isLogin && (
        <div className="space-y-2 border-t border-line pt-4">
          <Button type="button" variant="quiet" className="w-full" onClick={onPasskey} disabled={status === "loading"}>
            Sign in with a passkey
          </Button>
          {providers.map((p) => (
            <a key={p.slug} href={p.startUrl} className="inline-flex w-full items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-surface">
              Continue with {p.name}
            </a>
          ))}
        </div>
      )}
      <p className="text-center text-sm text-muted">
        {isLogin ? (
          <>
            New here? <Link href="/register" className="text-accent underline">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href="/login" className="text-accent underline">Sign in</Link>
          </>
        )}
      </p>
    </form>
  );
}

function ssoMessage(code: string): string {
  switch (code) {
    case "account_exists":
      return "An account with that email already exists. Sign in with your password, then link this provider.";
    case "invalid_state":
      return "That sign-in link expired. Please try again.";
    case "registration_closed":
      return "Registration is closed on this installation.";
    case "invalid_saml_response":
    case "sso_failed":
      return "Single sign-on failed. Please try again or contact an administrator.";
    default:
      return "Sign-in could not be completed.";
  }
}
