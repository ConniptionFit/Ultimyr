"use client";

import { StatusIcon, type Status } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { takeReturn } from "@/lib/after-login";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { signIn, register, verifyMfa, signInWithPasskey } = useAuth();
  const { copy } = useNaming();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [providers, setProviders] = useState<{ slug: string; name: string; startUrl: string }[]>([]);

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
      setError(err instanceof ApiError && err.code === "invalid_code" ? "That code did not work." : err instanceof ApiError && err.status === 401 ? "This sign-in expired. Start again." : "Something went wrong. Please try again.");
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
        else if (err.code === "registration_closed") setError("Registration is closed on this installation. Ask an administrator for an invitation.");
        else if (err.code === "invalid_request") setError(err.issues[0] ?? "Please check the details and try again.");
        else setError("Something went wrong. Please try again.");
      } else setError("Could not reach the server.");
    }
  }

  const isLogin = mode === "login";
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
