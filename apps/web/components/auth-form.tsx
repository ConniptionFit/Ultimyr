"use client";

import { StatusIcon, type Status } from "@ultimyr/ui-icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { ApiError, useAuth } from "@/lib/auth";
import { useNaming } from "@/lib/naming";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { signIn, register } = useAuth();
  const { copy } = useNaming();
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email"));
    const password = String(f.get("password"));
    setStatus("loading");
    setError(null);
    try {
      if (mode === "login") await signIn(email, password);
      else await register(String(f.get("displayName")), email, password);
      setStatus("success");
      router.push("/reading-room");
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
