"use client";

import { StatusIcon, type Status } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";

/** Landing page for an invite or password reset link from an administrator. The token is read from the address and sent once. */
export function SetPasswordForm() {
  const { setPassword } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
    // Keep the one-time token out of history and referrers once it is read.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    if (password !== String(f.get("confirm"))) {
      setStatus("error");
      setError("The two passwords do not match.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      await setPassword(token, password);
      setStatus("success");
      router.push("/reading-room");
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError && err.code === "invalid_token") setError("This link has expired or was already used. Ask an administrator for a new one.");
      else if (err instanceof ApiError && err.code === "invalid_request") setError(err.issues[0] ?? "Please check the password and try again.");
      else if (err instanceof ApiError && err.code === "local_users_disabled") setError("Password sign-in is turned off here. Use single sign-on.");
      else setError("Something went wrong. Please try again.");
    }
  }

  if (token === undefined) return null;
  if (!token)
    return (
      <div className="space-y-4">
        <h1 className="text-3xl">Set your password</h1>
        <p className="text-sm text-muted">This page needs the link an administrator sent you.</p>
        <Link href="/login" className="text-sm text-accent underline">
          Go to sign in
        </Link>
      </div>
    );
  return (
    <form onSubmit={onSubmit} className="ulti-fade space-y-5">
      <h1 className="text-3xl">Set your password</h1>
      <Field id="password" name="password" type="password" label="Password (12 characters or more)" autoComplete="new-password" autoFocus required minLength={12} />
      <Field id="confirm" name="confirm" type="password" label="Repeat the password" autoComplete="new-password" required minLength={12} />
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
