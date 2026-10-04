"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface User {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

type State = { status: "loading" } | { status: "anonymous" } | { status: "authenticated"; user: User; accessToken: string };

interface AuthValue {
  state: State;
  signIn: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

async function post(path: string, body?: unknown) {
  const res = await fetch(`/api/v1/auth/${path}`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  return res;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public issues: string[] = [],
  ) {
    super(code);
  }
}

async function session(res: Response): Promise<{ user: User; accessToken: string }> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
    throw new ApiError(res.status, data.error ?? "unknown_error", data.issues);
  }
  return res.json();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  // The access token lives only in memory; the httpOnly refresh cookie restores the session on load.
  useEffect(() => {
    let cancelled = false;
    post("refresh")
      .then(session)
      .then((s) => !cancelled && setState({ status: "authenticated", ...s }))
      .catch(() => !cancelled && setState({ status: "anonymous" }));
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await session(await post("login", { email, password }));
    setState({ status: "authenticated", ...s });
  }, []);
  const register = useCallback(async (displayName: string, email: string, password: string) => {
    const s = await session(await post("register", { displayName, email, password }));
    setState({ status: "authenticated", ...s });
  }, []);
  const signOut = useCallback(async () => {
    await post("logout").catch(() => undefined);
    setState({ status: "anonymous" });
  }, []);

  const value = useMemo(() => ({ state, signIn, register, signOut }), [state, signIn, register, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
